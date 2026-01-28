# Fallback Lab

Demo app for **fallback-chain-js**. Built with Next.js + shadcn/ui + Tailwind, plus Firebase Auth/Firestore and Vertex AI (Gemini).

## Local dev
```bash
pnpm install
pnpm -C apps/fallbacklab dev
```

## Required env (Vercel or local)
- `GOOGLE_SA_KEY_B64` (base64 service account JSON)
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `GOOGLE_GENAI_USE_VERTEXAI=true`
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_GA_ID` (Google Analytics Measurement ID)

## API
- `POST /api/run` — run the fallback chain and return attempts
- `GET /api/runs/{id}` — fetch a stored run (auth required)

See `public/llms.txt` and `openapi.json` for machine-readable docs.
