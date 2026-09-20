import { NextResponse } from "next/server";

import { getModelHealth, resetModelHealth } from "@/lib/modelHealth.js";

export async function GET() {
  const registry = await getModelHealth();
  return NextResponse.json(Object.entries(registry).map(([id, health]) => ({ id, ...health })));
}

export async function DELETE(request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing model id" }, { status: 400 });
  await resetModelHealth(id);
  return NextResponse.json({ success: true });
}
