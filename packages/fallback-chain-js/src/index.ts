export {
  fallback,
  acceptOk,
  acceptStatus,
  acceptTruthy,
  acceptDefined,
  TimeoutError,
  FallbackError,
  type NamedAttemptError,
  type MaybePromise,
  type AttemptContext,
  type CandidateFn,
  type Candidate,
  type FallbackOptions
} from "./core.js";

export {
  createFallbackChain,
  type CandidateHealth,
  type FallbackChainOptions,
  type FallbackChain
} from "./chain.js";

export {
  fallbackStream,
  type StreamAttemptContext,
  type StreamSource,
  type StreamCandidateFn,
  type StreamCandidate,
  type FallbackStreamOptions
} from "./stream.js";
