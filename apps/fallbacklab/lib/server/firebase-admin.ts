import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { loadServiceAccount } from "./sa";

let app: App | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function getApp(): App {
  if (app) return app;

  const sa = loadServiceAccount();
  if (!sa) {
    throw new Error("GOOGLE_SA_KEY_B64 is not configured");
  }

  app = getApps()[0] ?? initializeApp({ credential: cert(sa.json) });
  return app;
}

export function getAdminAuth(): Auth {
  if (!auth) auth = getAuth(getApp());
  return auth;
}

export function getAdminDb(): Firestore {
  if (!db) db = getFirestore(getApp());
  return db;
}
