# fallback-chain-js
Tiny fallback chains for JS/TS — try providers until one succeeds.

[![CI](https://github.com/khalidsaidi/fallback-chain-js/actions/workflows/ci.yml/badge.svg)](https://github.com/khalidsaidi/fallback-chain-js/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@khalidsaidi/fallback-chain-js)](https://www.npmjs.com/package/@khalidsaidi/fallback-chain-js)
[![types](https://img.shields.io/npm/types/@khalidsaidi/fallback-chain-js)](https://www.npmjs.com/package/@khalidsaidi/fallback-chain-js)
[![license](https://img.shields.io/github/license/khalidsaidi/fallback-chain-js)](https://github.com/khalidsaidi/fallback-chain-js/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@khalidsaidi/fallback-chain-js)](https://bundlephobia.com/package/@khalidsaidi/fallback-chain-js)

- Tiny core, zero runtime deps
- Works in Node, Bun, and Cloudflare Workers
- Fallback on errors AND unacceptable results
- AbortSignal + per-attempt timeouts
- Optional stateful chains with per-candidate cooldown/health memory (`createFallbackChain`)
- Streaming fallback with commit-on-first-chunk semantics (`fallbackStream`)
- Great for HTTP, storage, and LLM/provider failover

Demo app: https://fallbacklab.vercel.app

## Quickstart
```ts
import { fallback } from "@khalidsaidi/fallback-chain-js";

const result = await fallback([
  () => fetch("https://primary.example.com").then((r) => r.text()),
  () => fetch("https://backup.example.com").then((r) => r.text())
]);
```

## Why not X?

| Library | Difference |
|---------|-----------|
| `Promise.any` | Runs all promises immediately; this lib runs candidates **lazily** |
| `p-retry` | Retries the *same* operation; this lib tries *different* providers |
| `cockatiel` | Full resilience suite (circuit breakers, bulkheads); this lib is a **focused primitive** |
| `async-retry` | Same-operation retry with backoff; no multi-provider support |
| `ai-fallback` / Vercel AI Gateway | Provider failover built on/into the Vercel AI SDK. If you're all-in on the Vercel AI SDK, use those — they're deeply integrated. Use this when you're not: plain fetch, provider SDKs, non-LLM work, or when you want failover without adopting a framework |

**This library is a primitive** — single purpose, predictable, zero deps. Compose it with other tools as needed.

## Install
```bash
npm i @khalidsaidi/fallback-chain-js
```

## Usage

### Basic: first success wins
```ts
const value = await fallback([
  () => primary(),
  () => secondary()
]);
```

### Fallback on "bad results"
```ts
import { fallback, acceptOk } from "@khalidsaidi/fallback-chain-js";

const response = await fallback(
  [() => fetch(urlA), () => fetch(urlB)],
  { accept: acceptOk }
);
```

### Timeouts + AbortSignal
```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

const value = await fallback([
  ({ signal }) => fetch(urlA, { signal }).then((r) => r.json()),
  ({ signal }) => fetch(urlB, { signal }).then((r) => r.json())
], {
  signal: controller.signal,
  timeoutMs: 1_000
});
```

## Accept Helpers

Built-in validators for common patterns:

```ts
import {
  acceptOk,      // res.ok === true
  acceptStatus,  // res.status in [200, 201, ...]
  acceptTruthy,  // Boolean(value) === true
  acceptDefined  // value !== null && value !== undefined
} from "@khalidsaidi/fallback-chain-js";

// HTTP responses
await fallback([...], { accept: acceptOk });
await fallback([...], { accept: acceptStatus(200, 201, 204) });

// General values
await fallback([...], { accept: acceptTruthy });
await fallback([...], { accept: acceptDefined });
```

## Real-World Examples

### LLM Provider Failover

Different providers return different response shapes, so each candidate
normalizes to one common type. That lets a single `accept` (and your caller)
work with every provider:

```ts
interface LLMResult {
  provider: string;
  text: string;
}

const result = await fallback<LLMResult>([
  {
    name: "openai",
    run: async () => {
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
      });
      return { provider: "openai", text: res.choices[0]?.message?.content ?? "" };
    }
  },
  {
    name: "anthropic",
    run: async () => {
      const res = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      });
      const block = res.content[0];
      return { provider: "anthropic", text: block?.type === "text" ? block.text : "" };
    }
  }
], {
  accept: (r) => r.text.length > 0, // one accept, one shape
  timeoutMs: 30_000,
  onAttempt: ({ name, outcome }) => console.log(`${name}: ${outcome}`)
});

console.log(`${result.provider} said: ${result.text}`);
```

### Multi-Region Storage
```ts
const data = await fallback([
  () => s3UsEast.getObject(key),
  () => s3EuWest.getObject(key),
  () => r2.get(key)
], { accept: acceptDefined });
```

### Cache-Through Pattern
```ts
const user = await fallback([
  () => redis.get(`user:${id}`),
  () => postgres.query("SELECT * FROM users WHERE id = $1", [id]),
  () => userServiceApi.getUser(id)
], { accept: acceptDefined });
```

## Stateful Chains: Cooldown + Health (`createFallbackChain`)

`fallback()` is stateless — every call starts at candidate #1. When a provider
is having a bad hour, you don't want to pay its timeout on every single call.
`createFallbackChain` remembers recent failures per candidate:

- A candidate that fails goes on **cooldown** (default 30s, configurable).
- Cooling-down candidates are **deprioritized to the end of the chain** — not
  skipped outright, so the chain can never fail purely because everything is
  cooling down.
- A success **resets** that candidate's failure memory.
- `failureThreshold` (default 1) sets how many consecutive failures trigger
  the cooldown.

It's an optional, tree-shakeable wrapper — the plain `fallback()` is untouched.

```ts
import { createFallbackChain } from "@khalidsaidi/fallback-chain-js";

const chain = createFallbackChain([
  { name: "primary", run: () => callPrimary() },
  { name: "backup", run: () => callBackup() }
], {
  cooldownMs: 30_000,     // deprioritize a failing candidate for 30s
  failureThreshold: 1,    // ...after a single failure
  timeoutMs: 5_000        // all fallback() options work here too
});

// Call it per request. While "primary" is cooling down, "backup" is tried first.
const a = await chain.run();
const b = await chain.run({ signal: requestSignal }); // per-call overrides merge over base options

chain.health();
// [
//   { index: 0, name: "primary", consecutiveFailures: 1, coolingDown: true, cooldownUntil: 1735000030000, lastError: Error },
//   { index: 1, name: "backup", consecutiveFailures: 0, coolingDown: false, cooldownUntil: 0 }
// ]

chain.reset(); // clear all failure/cooldown memory
```

Semantics worth knowing:

- Failures that count against health: rejections, timeouts, and `accept`
  vetoes. **Caller-initiated aborts do not count** — they say nothing about
  the candidate.
- Concurrent `chain.run()` calls are safe: each call snapshots an ordering up
  front, and every settled attempt applies one synchronous state update.
- After a cooldown expires the candidate is tried in its original position
  again; if it fails once more it immediately re-enters cooldown.

## Streaming Fallback (`fallbackStream`)

Falling back on a *stream* (an LLM token stream, an SSE feed) has a hard
constraint that request/response fallback doesn't: **once the consumer has
seen chunks from provider A, you cannot splice provider B onto them** — B
would restart from the beginning and the consumer would render a garbled
mixture. Mid-stream fallback is unsolvable UX, so `fallbackStream` doesn't
attempt it. The semantics are deliberately crisp:

- **Before the first chunk** reaches the consumer, anything goes wrong —
  error, timeout, `acceptFirstChunk` veto — and we fall back to the next
  candidate. Nothing has been shown, so falling back is invisible.
- **From the first chunk on, we are committed**: errors propagate as-is.
- Abandoned candidates are cleaned up: their iterator's `return()` is called
  and **late-arriving chunks are dropped, never yielded to the consumer**.
- Consumer cleanup propagates: `break`/`return()`/`throw()` on the outer
  stream reaches the inner iterator (your provider's `finally` runs).
- A stream that completes cleanly with zero chunks completes the output
  stream — clean completion is not an error.

```ts
import { fallbackStream } from "@khalidsaidi/fallback-chain-js";

const stream = fallbackStream([
  { name: "openai", run: ({ signal }) => openaiTokenStream(prompt, signal) },
  { name: "anthropic", run: ({ signal }) => anthropicTokenStream(prompt, signal) }
], {
  timeoutMs: 3_000,                       // time budget to the FIRST chunk, per attempt
  acceptFirstChunk: (chunk) => chunk.length > 0, // veto before committing
  retryable: (err) => !isAuthError(err),  // don't rotate providers on bad credentials
  onAttempt: ({ name, outcome }) => console.log(`${name}: ${outcome}`)
});

for await (const token of stream) {
  process.stdout.write(token);
}
```

Candidates can return any `AsyncIterable`, `AsyncIterator`, or sync
`Iterable` — async generators, `ReadableStream`s (they're async-iterable in
Node/Workers/Bun), or arrays.

`timeoutMs` measures **time to first chunk only**. Once committed, a slow
chunk mid-stream is between the consumer and the provider (use `ctx.signal`
or an outer `AbortSignal` for whole-stream deadlines).

## Recipes

This library is a primitive. Here's how to compose it for advanced patterns:

### Retryable LLM Errors
Fall back on errors that a different provider might fix (429 rate limits,
5xx, timeouts, overloaded); throw fast on errors that every provider will
reject the same way (bad request, bad API key, content policy):

```ts
import { fallback, TimeoutError } from "@khalidsaidi/fallback-chain-js";

function retryableLLM(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;         // provider too slow → try next
  const status = (err as any)?.status ?? (err as any)?.response?.status;
  if (status === 429) return true;                      // rate limited → try next
  if (typeof status === "number" && status >= 500) return true; // provider down → try next
  if ((err as any)?.error?.type === "overloaded_error") return true; // Anthropic 529-style
  return false; // 400/401/403/content-policy: every provider agrees — throw fast
}

const result = await fallback([
  { name: "openai", run: () => askOpenAI(prompt) },
  { name: "anthropic", run: () => askAnthropic(prompt) }
], {
  retryable: retryableLLM,
  timeoutMs: 30_000
});
```

### Retry Within a Provider, Fall Back Across Providers
`p-retry` retries the *same* operation; this lib rotates *different*
providers. They compose cleanly — give each provider a few attempts with
backoff before rotating:

```ts
import pRetry from "p-retry";
import { fallback } from "@khalidsaidi/fallback-chain-js";

const withRetries = (fn: () => Promise<string>) =>
  pRetry(fn, { retries: 2, minTimeout: 250 }); // 3 total attempts, exponential backoff

const result = await fallback([
  { name: "openai", run: () => withRetries(() => askOpenAI(prompt)) },
  { name: "anthropic", run: () => withRetries(() => askAnthropic(prompt)) }
]);
// Worst case: openai tried 3×, then anthropic tried 3×.
```

### Hedged Requests
Start a backup request if the primary is slow (Google's "Tail at Scale" pattern):

```ts
async function hedge<T>(
  primary: () => Promise<T>,
  backup: () => Promise<T>,
  hedgeAfterMs: number
): Promise<T> {
  const controller = new AbortController();
  let backupStarted = false;

  const withBackup = new Promise<T>((resolve) => {
    setTimeout(() => {
      if (!controller.signal.aborted) {
        backupStarted = true;
        backup().then(resolve);
      }
    }, hedgeAfterMs);
  });

  const result = await Promise.race([
    primary().then((v) => { controller.abort(); return v; }),
    withBackup
  ]);

  return result;
}

// Usage
const data = await hedge(
  () => fetchPrimary(),
  () => fetchBackup(),
  100 // start backup if primary takes >100ms
);
```

### Parallel Race with Accept
Run all candidates in parallel, first acceptable result wins:

```ts
async function race<T>(
  candidates: Array<() => Promise<T>>,
  accept: (v: T) => boolean = () => true
): Promise<T> {
  const controller = new AbortController();

  return Promise.any(
    candidates.map(async (fn) => {
      const value = await fn();
      if (!accept(value)) throw new Error("unacceptable");
      controller.abort();
      return value;
    })
  );
}
```

### Get Winner Metadata
Track which candidate succeeded using the existing `onAttempt` hook:

```ts
let winner: { name?: string; attempt: number; durationMs: number } | undefined;

const value = await fallback([
  { name: "primary", run: () => fetchPrimary() },
  { name: "backup", run: () => fetchBackup() }
], {
  onAttempt: (info) => {
    if (info.outcome === "success") {
      winner = { name: info.name, attempt: info.attempt, durationMs: info.durationMs };
    }
  }
});

console.log(`Winner: ${winner?.name}`);
```

## API

```ts
fallback<T>(
  candidates: readonly Candidate<T>[],
  options?: FallbackOptions<T>
): Promise<T>
```

**Candidates:**
- `() => T | Promise<T>`
- `{ name?: string, run: (ctx) => T | Promise<T> }`

**Options:**
- `signal?: AbortSignal`
- `timeoutMs?: number | (ctx) => number | undefined`
- `accept?: (value, { attempt }) => boolean`
- `retryable?: (error, { attempt }) => boolean`
- `onAttempt?: ({ attempt, name, outcome, durationMs, value?, error? }) => void`

**Errors:**
- `TimeoutError` — candidate exceeded `timeoutMs`
- `FallbackError` — all candidates failed (includes `.errors` array)

```ts
createFallbackChain<T>(
  candidates: readonly Candidate<T>[],
  options?: FallbackChainOptions<T>
): FallbackChain<T>
```

**Options:** everything `fallback()` takes, plus:
- `cooldownMs?: number` — deprioritization window after failures (default `30_000`)
- `failureThreshold?: number` — consecutive failures before cooldown (default `1`)
- `now?: () => number` — injectable clock for tests

**Returns:**
- `run(overrides?)` — run the chain once; healthy candidates first, cooling ones last
- `health()` — per-candidate `{ index, name?, consecutiveFailures, coolingDown, cooldownUntil, lastError? }`
- `reset()` — clear all failure/cooldown memory

```ts
fallbackStream<T>(
  candidates: readonly StreamCandidate<T>[],
  options?: FallbackStreamOptions<T>
): AsyncGenerator<T>
```

**Candidates:** `(ctx) => AsyncIterable<T> | AsyncIterator<T> | Iterable<T>` (or `{ name?, run }`)

**Options:**
- `signal?: AbortSignal`
- `timeoutMs?` — per-attempt budget **to the first chunk**
- `retryable?: (error, { attempt }) => boolean` — applies to pre-first-chunk errors
- `acceptFirstChunk?: (chunk, { attempt }) => boolean` — veto a candidate before committing
- `onAttempt?` — same shape as `fallback()`; `"success"` means committed (or clean empty completion)

**Semantics:** fallback happens only **before** the first chunk reaches the
consumer; after that, errors propagate (mid-stream fallback is unsolvable UX).

## Runtime Support
Node 18+ / Bun / Cloudflare Workers (tested in CI)

## Contributing
```bash
pnpm install
pnpm -C packages/fallback-chain-js build
pnpm -C packages/fallback-chain-js test
```

## License
MIT
