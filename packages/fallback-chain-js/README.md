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
```ts
const response = await fallback([
  { name: "openai", run: () => openai.chat.completions.create({...}) },
  { name: "anthropic", run: () => anthropic.messages.create({...}) },
  { name: "local", run: () => ollama.chat({...}) }
], {
  accept: (r) => r.choices?.[0]?.message?.content?.length > 0,
  timeoutMs: 30_000,
  onAttempt: ({ name, outcome }) => console.log(`${name}: ${outcome}`)
});
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

## Recipes

This library is a primitive. Here's how to compose it for advanced patterns:

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
