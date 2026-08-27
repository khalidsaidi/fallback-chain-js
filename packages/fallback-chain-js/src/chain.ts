import {
  fallback,
  normalizeCandidate,
  type Candidate,
  type FallbackOptions
} from "./core.js";

// ─────────────────────────────────────────────────────────────
// createFallbackChain — stateful wrapper with per-candidate
// cooldown/health memory. Optional; the plain fallback() is
// untouched and this module tree-shakes away if unused.
// ─────────────────────────────────────────────────────────────

export interface CandidateHealth {
  /** Position of the candidate in the original array passed to createFallbackChain. */
  index: number;
  name?: string;
  /** Consecutive failures since the last success (or reset). */
  consecutiveFailures: number;
  /** True while the candidate is deprioritized. */
  coolingDown: boolean;
  /** Epoch ms when the cooldown ends; 0 when not cooling down. */
  cooldownUntil: number;
  /** The error from the most recent failure, if any. */
  lastError?: unknown;
}

export interface FallbackChainOptions<T> extends FallbackOptions<T> {
  /**
   * How long (ms) a failing candidate is deprioritized after hitting
   * `failureThreshold` consecutive failures. Default: 30_000.
   */
  cooldownMs?: number;
  /**
   * Consecutive failures before a candidate starts cooling down.
   * Default: 1 (a single failure deprioritizes it).
   */
  failureThreshold?: number;
  /** Clock, injectable for tests. Default: Date.now. */
  now?: () => number;
}

export interface FallbackChain<T> {
  /**
   * Run the chain once. Healthy candidates are tried first (in their
   * original order); cooling-down candidates are deprioritized to the
   * end (still in their original order) rather than skipped outright,
   * so the chain can never fail purely because everything is cooling
   * down. Per-call overrides (e.g. a per-request AbortSignal) are
   * merged over the options given to createFallbackChain.
   */
  run(overrides?: FallbackOptions<T>): Promise<T>;
  /** Snapshot of per-candidate health, in original candidate order. */
  health(): CandidateHealth[];
  /** Clear all failure/cooldown memory. */
  reset(): void;
}

interface CandidateState<T> {
  index: number;
  name?: string;
  candidate: Candidate<T>;
  consecutiveFailures: number;
  cooldownUntil: number;
  lastError?: unknown;
}

export function createFallbackChain<T>(
  candidates: readonly Candidate<T>[],
  options: FallbackChainOptions<T> = {}
): FallbackChain<T> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError(
      "createFallbackChain(candidates): candidates must be a non-empty array"
    );
  }

  const {
    cooldownMs = 30_000,
    failureThreshold = 1,
    now = Date.now,
    ...baseOptions
  } = options;

  const states: CandidateState<T>[] = candidates.map((candidate, index) => {
    const { name } = normalizeCandidate(candidate);
    const state: CandidateState<T> = {
      index,
      candidate,
      consecutiveFailures: 0,
      cooldownUntil: 0
    };
    if (name !== undefined) state.name = name;
    return state;
  });

  // State transitions are synchronous (single mutation per settled
  // attempt), so interleaved concurrent run() calls stay consistent:
  // each call snapshots an ordering up front and every completion
  // applies one atomic-in-JS update.
  const markFailure = (state: CandidateState<T>, error: unknown): void => {
    state.consecutiveFailures += 1;
    state.lastError = error;
    if (state.consecutiveFailures >= failureThreshold) {
      state.cooldownUntil = now() + cooldownMs;
    }
  };

  const markSuccess = (state: CandidateState<T>): void => {
    state.consecutiveFailures = 0;
    state.cooldownUntil = 0;
    state.lastError = undefined;
  };

  const run = (overrides: FallbackOptions<T> = {}): Promise<T> => {
    const t = now();
    const healthy = states.filter((s) => s.cooldownUntil <= t);
    const cooling = states.filter((s) => s.cooldownUntil > t);
    const ordered = [...healthy, ...cooling];

    const merged: FallbackOptions<T> = { ...baseOptions, ...overrides };
    const userOnAttempt = merged.onAttempt;

    const wrapped: Candidate<T>[] = ordered.map((state) => {
      const { run: runCandidate } = normalizeCandidate(state.candidate);
      return state.name === undefined
        ? { run: runCandidate }
        : { name: state.name, run: runCandidate };
    });

    return fallback(wrapped, {
      ...merged,
      onAttempt: (info) => {
        const state = ordered[info.attempt];
        if (state) {
          if (info.outcome === "success") {
            markSuccess(state);
          } else if (info.outcome !== "aborted") {
            // rejected / timeout / unacceptable all count against health.
            // Aborts are caller-initiated and say nothing about the candidate.
            markFailure(state, info.error);
          }
        }
        userOnAttempt?.(info);
      }
    });
  };

  const health = (): CandidateHealth[] => {
    const t = now();
    return states.map((s) => {
      const entry: CandidateHealth = {
        index: s.index,
        consecutiveFailures: s.consecutiveFailures,
        coolingDown: s.cooldownUntil > t,
        cooldownUntil: s.cooldownUntil > t ? s.cooldownUntil : 0
      };
      if (s.name !== undefined) entry.name = s.name;
      if (s.lastError !== undefined) entry.lastError = s.lastError;
      return entry;
    });
  };

  const reset = (): void => {
    for (const s of states) markSuccess(s);
  };

  return { run, health, reset };
}
