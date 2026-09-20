import { NextResponse } from "next/server";
import { getJevStats } from "@/lib/db/repos/usageRepo.js";

export async function GET(request) {
  const period = new URL(request.url).searchParams.get("period") || "7d";
  return NextResponse.json(await getJevStats(period));
}
