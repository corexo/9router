import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName, ensureBuiltinCombos, BUILTIN_COMBOS } from "@/lib/localDb";
import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";
async function getClaims() { return verifyDashboardAuthToken((await cookies()).get("auth_token")?.value).catch(() => null); }

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// GET /api/combos - Get all combos
export async function GET() {
  try {
    await ensureBuiltinCombos();
    const caller = await getClaims();
    const combos = await getCombos(caller?.username ? { ownerUsername: caller.username } : {});
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  try {
    const body = await request.json();
    const caller = await getClaims();
    const { name, models, kind } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    // Built-in combo names are reserved and provisioned by 9Router itself
    if (BUILTIN_COMBOS.includes(name.toLowerCase())) {
      return NextResponse.json({ error: `"${name}" is a built-in combo and cannot be created` }, { status: 400 });
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    const combo = await createCombo({ name, models: models || [], kind: kind || null, ownerUsername: caller?.username || null });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
