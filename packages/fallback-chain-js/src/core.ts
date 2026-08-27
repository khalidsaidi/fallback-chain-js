export type MaybePromise<T> = T | PromiseLike<T>;

export interface AttemptContext {
  attempt: number;
  signal: AbortSignal;
  errors: readonly unknown[];
}

export type CandidateFn<T> = (ctx: AttemptContext) => MaybePromise<T>;
export type Candidate<T> =
  | CandidateFn<T>
  | { name?: string; run: CandidateFn<T> };

export class TimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** One failed attempt, with the candidate's name when it was given as `{ name, run }`. */
export interface NamedAttemptError {
  name?: string;
  error: unknown;
}

export class FallbackError extends Error {
  readonly errors: readonly unknown[];
  /**
   * Per-attempt view of `errors` (same order, same length) with the
   * candidate's name attached when the candidate was named.
   */
  readonly named: readonly NamedAttemptError[];
  constructor(
    message: string,
    errors: readonly unknown[],
    named?: readonly NamedAttemptError[]
  ) {
    super(message);
    this.name = "FallbackError";
    this.errors = errors;
    this.named = named ?? errors.map((error) => ({ error }));
    // best-effort "cause" for runtimes that support it
    (this as any).cause = errors[errors.length - 1];
  }
}

/** @internal */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message ? `${err.name}: ${err.message}` : err.name;
  }
  try {
    return String(err);
  } catch {
    return "unknown error";
  }
}

/** @internal */
export function buildFallbackErrorMessage(
  count: number,
  named: readonly NamedAttemptError[]
): string {
  const base = `All ${count} fallback candidates failed`;
  if (!named.some((entry) => entry.name !== undefined)) return base;
  const parts = named.map(
    (entry, i) => `${entry.name ?? `#${i}`}: ${describeError(entry.error)}`
  );
  return `${base} (${parts.join("; ")})`;
}

export interface FallbackOptions<T> {
  /** Abort the whole chain (recommended to pass fetch/LLM signals through) */
  signal?: AbortSignal;

  /** Per-attempt timeout (ms). If a candidate ignores AbortSignal, we still enforce timeout via Promise.race. */
  timeoutMs?: number | ((ctx: { attempt: number }) => number | undefined);

  /**
   * Decide whether a resolved value is acceptable.
   * Return true to accept, false to fallback to the next candidate.
   */
  accept?: (value: T, ctx: { attempt: number }) => boolean;

  /**
   * Decide whether an error should trigger fallback.
   * Return true to continue to the next candidate, false to stop and throw immediately.
   */
  retryable?: (error: unknown, ctx: { attempt: number }) => boolean;

  /** Lightweight observability hook (no logging deps). */
  onAttempt?: (info: {
    attempt: number;
    name?: string;
    outcome: "success" | "rejected" | "unacceptable" | "timeout" | "aborted";
    durationMs: number;
    value?: T;
    error?: unknown;
  }) => void;
}

/** @internal */
export function isAbortLike(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "name" in err &&
    (err as any).name === "AbortError"
  );
}

/** @internal */
export function normalizeCandidate<T>(c: Candidate<T>): { name?: string; run: CandidateFn<T> } {
  if (typeof c === "function") return { run: c };
  if (c.name === undefined) return { run: c.run };
  return { name: c.name, run: c.run };
}

/** @internal — throws TypeError instead of letting a bad value silently disable the timeout. */
export function validateTimeoutMs(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    const got =
      typeof value === "number" ? String(value) : `${String(value)} (${typeof value})`;
    throw new TypeError(`timeoutMs must be a non-negative number, got ${got}`);
  }
  return value;
}

/** @internal */
export function getTimeoutMs<T>(
  timeoutMs: FallbackOptions<T>["timeoutMs"],
  attempt: number
): number | undefined {
  const resolved = typeof timeoutMs === "function" ? timeoutMs({ attempt }) : timeoutMs;
  return validateTimeoutMs(resolved);
}

// ─────────────────────────────────────────────────────────────
// Accept Helpers
// ─────────────────────────────────────────────────────────────

/** Accept if Response.ok is true */
export const acceptOk = (res: { ok: boolean }) => res.ok;

/** Accept if Response.status is one of the given codes */
export const acceptStatus = (...codes: number[]) =>
  (res: { status: number }) => codes.includes(res.status);

/** Accept if value is truthy */
export const acceptTruthy = <T>(v: T) => Boolean(v);

/** Accept if value is not null/undefined */
export const acceptDefined = <T>(v: T) => v !== null && v !== undefined;

// ─────────────────────────────────────────────────────────────
// Core fallback function
// ─────────────────────────────────────────────────────────────

export async function fallback<T>(
  candidates: readonly Candidate<T>[],
  options: FallbackOptions<T> = {}
): Promise<T> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError("fallback(candidates): candidates must be a non-empty array");
  }

  if (typeof options.timeoutMs !== "function") validateTimeoutMs(options.timeoutMs);

  if (options.signal?.aborted) {
    throw (options.signal as any).reason ?? Object.assign(new Error("Aborted"), { name: "AbortError" });
  }

  const accept = options.accept ?? (() => true);
  const retryable =
    options.retryable ??
    ((err) => {
      if (isAbortLike(err)) return false;
      return true;
    });

  const errors: unknown[] = [];
  const namedErrors: NamedAttemptError[] = [];
  const recordError = (name: string | undefined, error: unknown): void => {
    errors.push(error);
    namedErrors.push(name === undefined ? { error } : { name, error });
  };

  for (let attempt = 0; attempt < candidates.length; attempt++) {
    const { name, run } = normalizeCandidate(candidates[attempt]!);
    const started = Date.now();

    const controller = new AbortController();
    const cleanup: Array<() => void> = [];

    if (options.signal) {
      const onAbort = () => controller.abort();
      if (options.signal.aborted) controller.abort();
      else {
        options.signal.addEventListener("abort", onAbort, { once: true });
        cleanup.push(() => options.signal?.removeEventListener("abort", onAbort));
      }
    }

    const perAttemptTimeout = getTimeoutMs(options.timeoutMs, attempt);

    let timeoutId: any | undefined;
    let timeoutRejection: Promise<never> | undefined;

    if (perAttemptTimeout !== undefined && Number.isFinite(perAttemptTimeout)) {
      timeoutRejection = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new TimeoutError(perAttemptTimeout));
        }, perAttemptTimeout);
      });
      cleanup.push(() => clearTimeout(timeoutId));
    }

    const ctx: AttemptContext = { attempt, signal: controller.signal, errors };

    try {
      const value = await (timeoutRejection
        ? Promise.race([Promise.resolve(run(ctx)), timeoutRejection])
        : Promise.resolve(run(ctx))) as T;

      if (!accept(value, { attempt })) {
        const err = Object.assign(new Error("Unacceptable result"), {
          name: "UnacceptableResultError",
          value
        });
        recordError(name, err);
        const info = {
          attempt,
          outcome: "unacceptable" as const,
          durationMs: Date.now() - started,
          value
        };
        if (name === undefined) options.onAttempt?.(info);
        else options.onAttempt?.({ ...info, name });
        continue;
      }

      const info = {
        attempt,
        outcome: "success" as const,
        durationMs: Date.now() - started,
        value
      };
      if (name === undefined) options.onAttempt?.(info);
      else options.onAttempt?.({ ...info, name });

      return value;
    } catch (err) {
      const durationMs = Date.now() - started;

      const outcome: "rejected" | "timeout" | "aborted" =
        err instanceof TimeoutError
          ? "timeout"
          : isAbortLike(err) || controller.signal.aborted
            ? "aborted"
            : "rejected";

      const info = { attempt, outcome, durationMs, error: err };
      if (name === undefined) options.onAttempt?.(info);
      else options.onAttempt?.({ ...info, name });

      if (outcome === "aborted") throw err;

      if (!retryable(err, { attempt })) throw err;

      recordError(name, err);
      continue;
    } finally {
      for (const fn of cleanup) fn();
    }
  }

  throw new FallbackError(
    buildFallbackErrorMessage(candidates.length, namedErrors),
    errors,
    namedErrors
  );
}
