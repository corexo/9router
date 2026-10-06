import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { getUserPrefs, updateUserPrefs } from "@/lib/db/repos/userPrefsRepo";

async function caller() { return verifyDashboardAuthToken((await cookies()).get("auth_token")?.value).catch(() => null); }
export async function GET() {
  const claims = await caller();
  if (!claims?.username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ preferences: await getUserPrefs(claims.username) });
}
export async function PATCH(request) {
  const claims = await caller();
  if (!claims?.username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ preferences: await updateUserPrefs(claims.username, await request.json()) });
}
