import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { getProviderConnectionById } from "@/lib/localDb";
import { testSingleConnection } from "./testUtils.js";

// POST /api/providers/[id]/test - Test connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const caller = await verifyDashboardAuthToken((await cookies()).get("auth_token")?.value).catch(() => null);
    const connection = await getProviderConnectionById(id);
    if (!connection || (caller?.username && connection.ownerUsername !== caller.username)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const result = await testSingleConnection(id);

    if (result.error === "Connection not found") {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
    });
  } catch (error) {
    console.log("Error testing connection:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
