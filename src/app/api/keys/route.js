import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";

// Caller claims from the dashboard session cookie (legacy single-user tokens
// carry no role → treated as admin scope for backward compatibility).
async function getCallerClaims() {
  try {
    const cookieStore = await cookies();
    return await verifyDashboardAuthToken(cookieStore.get("auth_token")?.value);
  } catch {
    return null;
  }
}

// GET /api/keys - List API keys (moderators only see their own keys)
export async function GET() {
  try {
    const claims = await getCallerClaims();
    const keys = await getApiKeys();
    const visible = claims?.role === "moderator"
      ? keys.filter((k) => k.ownerUsername === claims.username)
      : keys;
    return NextResponse.json({ keys: visible });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const claims = await getCallerClaims();
    const apiKey = await createApiKey(name, machineId, claims?.username || null);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
