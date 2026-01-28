import { NextResponse, type NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
  }

  const token = authHeader.slice("Bearer ".length);
  const decoded = await getAdminAuth().verifyIdToken(token).catch(() => null);
  if (!decoded) {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }

  const db = getAdminDb();
  const doc = await db.collection("runs").doc(id).get();
  if (!doc.exists) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = doc.data();
  if (!data || data.userId !== decoded.uid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ id: doc.id, ...data });
}
