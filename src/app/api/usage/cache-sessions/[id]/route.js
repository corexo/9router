import { NextResponse } from "next/server";
import { getSessionCacheDetail } from "@/lib/jev/sessionCache.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const session = getSessionCacheDetail(id);
    if (!session) {
      return NextResponse.json({ error: "Session nicht gefunden oder abgelaufen" }, { status: 404 });
    }
    return NextResponse.json({ session });
  } catch (error) {
    console.error("[API] Failed to get cache session detail:", error);
    return NextResponse.json({ error: "Fehler beim Laden der Session-Details" }, { status: 500 });
  }
}
