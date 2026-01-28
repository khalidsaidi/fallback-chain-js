import "server-only";
import { existsSync, writeFileSync } from "node:fs";

let cached: { path: string; json: Record<string, unknown> } | null = null;

export function loadServiceAccount() {
  if (cached) return cached;
  const keyB64 = process.env.GOOGLE_SA_KEY_B64;
  if (!keyB64) return null;

  const jsonText = Buffer.from(keyB64, "base64").toString("utf8");
  const path = "/tmp/google-sa.json";

  if (!existsSync(path)) {
    writeFileSync(path, jsonText, "utf8");
  }

  process.env.GOOGLE_APPLICATION_CREDENTIALS = path;
  cached = { path, json: JSON.parse(jsonText) as Record<string, unknown> };
  return cached;
}
