# fallback-chain-js
Tiny fallback chains for JS/TS — try providers until one succeeds.

Monorepo layout:
- `packages/fallback-chain-js`: the tiny library
- `apps/fallbacklab`: Next.js demo app (Firebase + Vertex AI)

Demo: https://fallbacklab.vercel.app

## Library quickstart
```bash
pnpm -C packages/fallback-chain-js build
```

```ts
import { fallback } from "fallback-chain-js";

const result = await fallback([
  () => primary(),
  () => secondary()
]);
```

## How fallback works (short)
- Candidates are lazy functions called one-by-one.
- Rejections fall through to the next candidate.
- Resolved values can be rejected via `accept(...)`.
- `AbortSignal` and per-attempt `timeoutMs` are supported.

## AI discoverability
- Root: `llms.txt`
- Demo API: `apps/fallbacklab/public/llms.txt`
- OpenAPI: `apps/fallbacklab/openapi.json`

## Development
```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Packages
- Library docs: `packages/fallback-chain-js/README.md`
- Demo app docs: `apps/fallbacklab/README.md`
