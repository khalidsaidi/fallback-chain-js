import { NextResponse, type NextRequest } from "next/server";
import { fallback, type Candidate } from "@khalidsaidi/fallback-chain-js";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/server/firebase-admin";
import { getGenAI } from "@/lib/server/genai";

export const runtime = "nodejs";

type AttemptLog = {
  attempt: number;
  name?: string;
  outcome: "success" | "rejected" | "unacceptable" | "timeout" | "aborted";
  durationMs: number;
  error?: string;
};

type PageResult = {
  text: string;
  source: string;
};

type SummaryResult = {
  answer: string;
  provider: string;
  bullets?: string[];
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getCacheId(url: string) {
  return Buffer.from(url).toString("base64url");
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeJsonParse(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(input.slice(start, end + 1));
    }
  }
  return null;
}

async function fetchText(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal, redirect: "follow" });
  if (!res.ok) {
    throw new Error(`fetch_failed:${res.status}`);
  }
  const html = await res.text();
  const text = stripHtml(html);
  return text;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url, question, options, demo } = body as {
    url?: string;
    question?: string;
    options?: { timeoutMs?: number };
    demo?: boolean;
  };

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  let userId: string | null = null;
  const authHeader = req.headers.get("authorization");

  if (!demo && authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    try {
      const decoded = await getAdminAuth().verifyIdToken(token);
      userId = decoded.uid;
    } catch {
      return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
    }
  }

  const pageAttempts: AttemptLog[] = [];
  const summaryAttempts: AttemptLog[] = [];

  const timeoutMs = typeof options?.timeoutMs === "number" ? options.timeoutMs : 8000;
  const cacheId = getCacheId(url);

  const pageCandidates: Candidate<PageResult>[] = [];

  if (process.env.GOOGLE_SA_KEY_B64) {
    pageCandidates.push({
      name: "firestore-cache",
      run: async () => {
        const db = getAdminDb();
        const doc = await db.collection("pageCache").doc(cacheId).get();
        if (!doc.exists) throw new Error("cache_miss");
        const data = doc.data() as { text?: string; updatedAt?: { toMillis?: () => number }; fetchedAtMs?: number } | undefined;
        const cachedAt = data?.updatedAt?.toMillis?.() ?? data?.fetchedAtMs;
        if (!data?.text || !cachedAt) throw new Error("cache_invalid");
        if (Date.now() - cachedAt > ONE_DAY_MS) throw new Error("cache_stale");
        return { text: data.text, source: "cache" };
      }
    });
  }

  pageCandidates.push({
    name: "direct-fetch",
    run: async ({ signal }) => {
      const text = await fetchText(url, signal);
      const trimmed = text.slice(0, 200_000);
      if (process.env.GOOGLE_SA_KEY_B64) {
        const db = getAdminDb();
        await db.collection("pageCache").doc(cacheId).set(
          {
            url,
            text: trimmed,
            fetchedAtMs: Date.now(),
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }
      return { text: trimmed, source: "fetch" };
    }
  });

  const mirrorPrefix = process.env.FALLBACKLAB_MIRROR_PREFIX;
  if (mirrorPrefix) {
    pageCandidates.push({
      name: "mirror-fetch",
      run: async ({ signal }) => {
        const mirrorUrl = `${mirrorPrefix}${url}`;
        const text = await fetchText(mirrorUrl, signal);
        const trimmed = text.slice(0, 200_000);
        if (process.env.GOOGLE_SA_KEY_B64) {
          const db = getAdminDb();
          await db.collection("pageCache").doc(cacheId).set(
            {
              url,
              text: trimmed,
              fetchedAtMs: Date.now(),
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        }
        return { text: trimmed, source: "mirror" };
      }
    });
  }

  const page = await fallback(pageCandidates, {
    timeoutMs,
    accept: (value) => Boolean(value.text && value.text.length > 0),
    onAttempt: (info) => {
      pageAttempts.push({
        attempt: info.attempt,
        name: info.name,
        outcome: info.outcome,
        durationMs: info.durationMs,
        error: info.error ? String((info.error as Error).message ?? info.error) : undefined
      });
    }
  });

  const summaryCandidates: Candidate<SummaryResult>[] = [];

  if (process.env.GOOGLE_SA_KEY_B64 && process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_LOCATION) {
    summaryCandidates.push({
      name: "vertex-gemini",
      run: async () => {
        const ai = getGenAI();
        const prompt = [
          "You are a precise summarizer.",
          "Return ONLY valid JSON with keys: answer (string), bullets (string[]).",
          "No markdown, no code fences.",
          `Question: ${question}`,
          "Context:",
          page.text.slice(0, 12000)
        ].join("\n");

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        });

        const parsed = safeJsonParse(response.text ?? "");
        if (!parsed || typeof parsed.answer !== "string") {
          throw new Error("invalid_json");
        }

        return {
          answer: parsed.answer,
          bullets: Array.isArray(parsed.bullets) ? parsed.bullets : undefined,
          provider: "vertex-gemini-2.5-flash"
        };
      }
    });
  }

  if (process.env.FALLBACKLAB_SECONDARY_URL) {
    summaryCandidates.push({
      name: "secondary-provider",
      run: async ({ signal }) => {
        const res = await fetch(process.env.FALLBACKLAB_SECONDARY_URL as string, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(process.env.FALLBACKLAB_SECONDARY_AUTH
              ? { authorization: `Bearer ${process.env.FALLBACKLAB_SECONDARY_AUTH}` }
              : {})
          },
          body: JSON.stringify({ text: page.text.slice(0, 12000), question }),
          signal
        });

        if (!res.ok) throw new Error(`secondary_failed:${res.status}`);
        const data = await res.json();
        if (!data || typeof data.answer !== "string") throw new Error("secondary_invalid");
        return { answer: data.answer, provider: "secondary" };
      }
    });
  }

  summaryCandidates.push({
    name: "deterministic",
    run: async () => {
      const compact = page.text.replace(/\s+/g, " ").trim();
      const snippet = compact.slice(0, 800);
      const answer = snippet
        ? `Summary: ${snippet}${compact.length > snippet.length ? "…" : ""}`
        : "Summary unavailable for this page.";
      return { answer, provider: "deterministic" };
    }
  });

  const summary = await fallback(summaryCandidates, {
    accept: (value) => Boolean(value.answer && value.answer.length > 0),
    onAttempt: (info) => {
      summaryAttempts.push({
        attempt: info.attempt,
        name: info.name,
        outcome: info.outcome,
        durationMs: info.durationMs,
        error: info.error ? String((info.error as Error).message ?? info.error) : undefined
      });
    }
  });

  let runId: string | null = null;
  if (userId && !demo && process.env.GOOGLE_SA_KEY_B64) {
    const db = getAdminDb();
    const doc = await db.collection("runs").add({
      userId,
      url,
      question,
      provider: summary.provider,
      createdAt: FieldValue.serverTimestamp(),
      attempts: { page: pageAttempts, summary: summaryAttempts },
      answer: summary.answer
    });
    runId = doc.id;
  }

  return NextResponse.json({
    ok: true,
    runId,
    page: {
      text: page.text,
      source: page.source,
      attempts: pageAttempts
    },
    summary: {
      answer: summary.answer,
      provider: summary.provider,
      bullets: summary.bullets,
      attempts: summaryAttempts
    }
  });
}
