import "server-only";
import { GoogleGenAI } from "@google/genai";
import { loadServiceAccount } from "./sa";

let client: GoogleGenAI | null = null;

export function getGenAI() {
  if (client) return client;

  loadServiceAccount();

  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION;

  if (!project || !location) {
    throw new Error("GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION must be set");
  }

  process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
  client = new GoogleGenAI({ vertexai: true, project, location });
  return client;
}
