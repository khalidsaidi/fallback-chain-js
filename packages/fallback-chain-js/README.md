# fallback-chain-js
Tiny fallback chains for JS/TS — try providers until one succeeds.

[![CI](https://github.com/khalidsaidi/fallback-chain-js/actions/workflows/ci.yml/badge.svg)](https://github.com/khalidsaidi/fallback-chain-js/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/fallback-chain-js)](https://www.npmjs.com/package/fallback-chain-js)
[![types](https://img.shields.io/npm/types/fallback-chain-js)](https://www.npmjs.com/package/fallback-chain-js)
[![license](https://img.shields.io/github/license/khalidsaidi/fallback-chain-js)](https://github.com/khalidsaidi/fallback-chain-js/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/fallback-chain-js)](https://bundlephobia.com/package/fallback-chain-js)

- ✅ Tiny core, zero runtime deps
- ✅ Works in Node, Bun, and Cloudflare Workers
- ✅ Fallback on errors AND unacceptable results
- ✅ AbortSignal + per-attempt timeouts
- ✅ Great for HTTP, storage, and LLM/provider failover

Demo app: https://fallbacklab.vercel.app

## Quickstart (30s)
```ts
import { fallback } from "fallback-chain-js";

const result = await fallback([
  () => fetch("https://primary.example.com").then((r) => r.text()),
  () => fetch("https://backup.example.com").then((r) => r.text())
]);
```

## Why this exists
- fallback ≠ retry (we do not re-run the same provider)
- fallback ≠ circuit breaker (no state, no half-open logic)
- this lib is a primitive, not a resilience suite

## Install
```bash
npm i fallback-chain-js
pnpm add fallback-chain-js
yarn add fallback-chain-js
bun add fallback-chain-js
```

## Usage
### Basic: first success wins
```ts
const value = await fallback([
  () => primary(),
  () => secondary()
]);
```

### Fallback on “bad results”
```ts
const response = await fallback(
  [() => fetch(urlA), () => fetch(urlB)],
  { accept: (r) => r.ok }
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

### LLM/provider failover (generic example)
```ts
const text = await fallback(
  [
    () => callModel("primary"),
    () => callModel("backup")
  ],
  { accept: (txt) => typeof txt === "string" && txt.trim().length > 0 }
);
```

## API
```ts
fallback<T>(
  candidates: readonly Candidate<T>[],
  options?: FallbackOptions<T>
): Promise<T>
```

Candidates:
- `() => T | Promise<T>`
- `{ name?: string, run: (ctx) => T | Promise<T> }`

Options:
- `signal?: AbortSignal`
- `timeoutMs?: number | (ctx) => number | undefined`
- `accept?: (value, { attempt }) => boolean`
- `retryable?: (error, { attempt }) => boolean`
- `onAttempt?: ({ attempt, name, outcome, durationMs, value?, error? }) => void`

Errors:
- `TimeoutError` when a candidate exceeds `timeoutMs`
- `FallbackError` when all candidates failed

## Runtime support
Node 18+ / Bun / Workers (tested in CI)

## Design goals
Single purpose, predictable, no deps, cross-runtime

## FAQ
**Why not `Promise.any`?** It runs all promises immediately; this library runs candidates lazily.

**Why functions and not promises?** We want to avoid starting work until needed and pass per-attempt context.

## Contributing
```bash
pnpm install
pnpm -C packages/fallback-chain-js build
pnpm -C packages/fallback-chain-js typecheck
pnpm -C packages/fallback-chain-js test:node
pnpm -C packages/fallback-chain-js test:workers
pnpm -C packages/fallback-chain-js test:bun
```

## License
MIT
