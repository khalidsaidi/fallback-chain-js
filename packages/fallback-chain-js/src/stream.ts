import {
  FallbackError,
  TimeoutError,
  getTimeoutMs,
  isAbortLike,
  type MaybePromise
} from "./core.js";

// ─────────────────────────────────────────────────────────────
// fallbackStream — async-iterable fallback for streaming.
//
// Semantics (deliberately crisp):
// - A candidate produces an AsyncIterable (or iterator). We race its
//   FIRST chunk against timeoutMs and the outer AbortSignal.
// - If the candidate errors, times out, or its first chunk is vetoed
//   by acceptFirstChunk — all BEFORE anything reached the consumer —
//   we fall back to the next candidate.
// - The moment the first chunk is yielded to the consumer we are
//   COMMITTED: any later error propagates as-is. Mid-stream fallback
//   is unsolvable UX (the consumer already rendered half of stream A;
//   you cannot splice stream B onto it), so we do not attempt it.
// - A stream that completes cleanly with ZERO chunks completes the
//   output stream (clean completion is not an error).
// - Abandoned candidates are cleaned up: their iterator's return() is
//   called best-effort and late-arriving chunks are dropped, never
//   yielded to the consumer.
// - Consumer-side cleanup propagates: return()/throw() on the outer
//   generator reaches the committed inner iterator.
// ─────────────────────────────────────────────────────────────

export interface StreamAttemptContext {
  attempt: number;
  /** Aborted when this attempt is abandoned (timeout/fallback) or the outer signal fires. */
  signal: AbortSignal;
  errors: readonly unknown[];
}

export type StreamSource<T> =
  | AsyncIterable<T>
  | AsyncIterator<T>
  | Iterable<T>;

export type StreamCandidateFn<T> = (
  ctx: StreamAttemptContext
) => MaybePromise<StreamSource<T>>;

export type StreamCandidate<T> =
  | StreamCandidateFn<T>
  | { name?: string; run: StreamCandidateFn<T> };

export interface FallbackStreamOptions<T> {
  /** Abort the whole stream (pass fetch/LLM signals through via ctx.signal). */
  signal?: AbortSignal;

  /**
   * Per-attempt time budget (ms) to the FIRST chunk. Once a candidate
   * has yielded its first chunk, the timeout no longer applies —
   * a slow chunk mid-stream is the candidate's problem, not fallback's.
   */
  timeoutMs?: number | ((ctx: { attempt: number }) => number | undefined);

  /**
   * Decide whether a pre-first-chunk error should trigger fallback.
   * Return true to continue to the next candidate, false to throw immediately.
   */
  retryable?: (error: unknown, ctx: { attempt: number }) => boolean;

  /**
   * Inspect the first chunk BEFORE committing to a candidate.
   * Return false to abandon this candidate and fall back — the chunk
   * is never yielded to the consumer.
   */
  acceptFirstChunk?: (chunk: T, ctx: { attempt: number }) => boolean;

  /** Lightweight observability hook. "success" = committed (first chunk accepted) or clean empty completion. */
  onAttempt?: (info: {
    attempt: number;
    name?: string;
    outcome: "success" | "rejected" | "unacceptable" | "timeout" | "aborted";
    durationMs: number;
    error?: unknown;
  }) => void;
}

function normalizeStreamCandidate<T>(c: StreamCandidate<T>): {
  name?: string;
  run: StreamCandidateFn<T>;
} {
  if (typeof c === "function") return { run: c };
  if (c.name === undefined) return { run: c.run };
  return { name: c.name, run: c.run };
}

function toAsyncIterator<T>(source: StreamSource<T>): AsyncIterator<T> {
  if (source != null && typeof (source as AsyncIterable<T>)[Symbol.asyncIterator] === "function") {
    return (source as AsyncIterable<T>)[Symbol.asyncIterator]();
  }
  if (source != null && typeof (source as Iterable<T>)[Symbol.iterator] === "function") {
    const it = (source as Iterable<T>)[Symbol.iterator]();
    return {
      next: () => Promise.resolve(it.next()),
      return: (value?: unknown) => {
        const res = it.return ? it.return(value as T) : { done: true as const, value: undefined };
        return Promise.resolve(res as IteratorResult<T>);
      }
    };
  }
  if (source != null && typeof (source as AsyncIterator<T>).next === "function") {
    return source as AsyncIterator<T>;
  }
  throw new TypeError(
    "fallbackStream candidate must return an AsyncIterable, AsyncIterator, or Iterable"
  );
}

export async function* fallbackStream<T>(
  candidates: readonly StreamCandidate<T>[],
  options: FallbackStreamOptions<T> = {}
): AsyncGenerator<T, void, undefined> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError(
      "fallbackStream(candidates): candidates must be a non-empty array"
    );
  }

  if (options.signal?.aborted) {
    throw (
      (options.signal as any).reason ??
      Object.assign(new Error("Aborted"), { name: "AbortError" })
    );
  }

  const retryable = options.retryable ?? ((err: unknown) => !isAbortLike(err));
  const acceptFirstChunk = options.acceptFirstChunk ?? (() => true);
  const errors: unknown[] = [];

  for (let attempt = 0; attempt < candidates.length; attempt++) {
    const { name, run } = normalizeStreamCandidate<T>(candidates[attempt]!);
    const started = Date.now();

    const controller = new AbortController();
    let detachOuter: () => void = () => {};

    if (options.signal) {
      const outer = options.signal;
      const onAbort = () => controller.abort((outer as any).reason);
      if (outer.aborted) controller.abort((outer as any).reason);
      else {
        outer.addEventListener("abort", onAbort, { once: true });
        detachOuter = () => outer.removeEventListener("abort", onAbort);
      }
    }

    const emit = (
      outcome: "success" | "rejected" | "unacceptable" | "timeout" | "aborted",
      error?: unknown
    ): void => {
      if (!options.onAttempt) return;
      const info: Parameters<NonNullable<FallbackStreamOptions<T>["onAttempt"]>>[0] = {
        attempt,
        outcome,
        durationMs: Date.now() - started
      };
      if (name !== undefined) info.name = name;
      if (error !== undefined) info.error = error;
      options.onAttempt(info);
    };

    let iterator: AsyncIterator<T> | undefined;
    let abandoned = false;

    // Abandon this attempt: abort its signal, close its iterator
    // best-effort, and guarantee late chunks are dropped (the obtain
    // closure below re-checks `abandoned` after every await).
    const discard = (): void => {
      abandoned = true;
      detachOuter();
      controller.abort();
      const it = iterator;
      if (it?.return) {
        try {
          Promise.resolve(it.return()).catch(() => {});
        } catch {
          /* best-effort */
        }
      }
    };

    const perAttemptTimeout = getTimeoutMs(options.timeoutMs, attempt);
    let timeoutId: any | undefined;
    let timeoutRejection: Promise<never> | undefined;

    if (
      typeof perAttemptTimeout === "number" &&
      Number.isFinite(perAttemptTimeout) &&
      perAttemptTimeout >= 0
    ) {
      timeoutRejection = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new TimeoutError(perAttemptTimeout));
        }, perAttemptTimeout);
      });
    }

    const ctx: StreamAttemptContext = {
      attempt,
      signal: controller.signal,
      errors
    };

    // Obtain the iterator and pull the first chunk. Re-checks
    // `abandoned` after every await so a candidate that loses the
    // timeout race is closed and its late chunk never leaks.
    const obtain: Promise<IteratorResult<T>> = (async () => {
      const produced: StreamSource<T> = await run(ctx);
      const it = toAsyncIterator<T>(produced);
      if (abandoned) {
        try {
          await it.return?.();
        } catch {
          /* best-effort */
        }
        throw Object.assign(new Error("Attempt abandoned"), { name: "AbortError" });
      }
      iterator = it;
      const res = await it.next();
      if (abandoned && it.return) {
        try {
          await it.return();
        } catch {
          /* best-effort */
        }
      }
      return res;
    })();
    // If the timeout wins the race, obtain's eventual rejection must
    // not become an unhandled rejection.
    obtain.catch(() => {});

    let first: IteratorResult<T>;
    try {
      first = await (timeoutRejection
        ? Promise.race([obtain, timeoutRejection])
        : obtain);
    } catch (err) {
      clearTimeout(timeoutId);
      const outcome: "rejected" | "timeout" | "aborted" =
        err instanceof TimeoutError
          ? "timeout"
          : isAbortLike(err) || options.signal?.aborted
            ? "aborted"
            : "rejected";
      emit(outcome, err);
      discard();
      if (outcome === "aborted") throw err;
      if (!retryable(err, { attempt })) throw err;
      errors.push(err);
      continue;
    }
    clearTimeout(timeoutId);

    if (first.done) {
      // Clean zero-chunk completion: not an error, so not a fallback.
      detachOuter();
      emit("success");
      return;
    }

    if (!acceptFirstChunk(first.value, { attempt })) {
      const err = Object.assign(new Error("Unacceptable first chunk"), {
        name: "UnacceptableResultError",
        value: first.value
      });
      emit("unacceptable", err);
      discard();
      errors.push(err);
      continue;
    }

    // ── COMMITTED ── the consumer is about to see data from this
    // candidate; from here on, errors propagate (no mid-stream fallback).
    emit("success");

    const committed = iterator!;
    let reachedLoop = false;
    try {
      yield first.value;
      reachedLoop = true;
      // for-await propagates consumer return()/throw() to committed.return().
      const rest: AsyncIterable<T> = {
        [Symbol.asyncIterator]: () => committed
      };
      for await (const chunk of rest) {
        yield chunk;
      }
      return;
    } finally {
      detachOuter();
      if (!reachedLoop && committed.return) {
        // Consumer bailed during the very first yield — for-await never
        // started, so propagate cleanup to the inner iterator ourselves.
        try {
          await committed.return();
        } catch {
          /* best-effort */
        }
      }
    }
  }

  throw new FallbackError(
    `All ${candidates.length} fallback candidates failed`,
    errors
  );
}
