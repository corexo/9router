import { NextResponse } from "next/server";
import { getPaidTrafficData, hydratePaidTraffic } from "@/lib/jev/paidTrafficBalancer.js";
import { getUsageStats } from "@/lib/db/repos/usageRepo.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await hydratePaidTraffic();
    const [traffic, usage] = await Promise.all([Promise.resolve(getPaidTrafficData()), getUsageStats("7d")]);
    const accounts = Object.values(usage?.byAccount || {}).map((account) => ({
      provider: account.provider,
      account: account.accountName || account.connectionId,
      requests: account.requests || 0,
      tokens: (account.promptTokens || 0) + (account.completionTokens || 0),
      cost: account.cost || 0,
    })).filter((account) => account.cost > 0);
    return NextResponse.json({ ...traffic, usage: accounts });
  } catch (error) {
    console.error("[API] Failed to get paid traffic data:", error);
    return NextResponse.json({ error: "Failed to fetch paid traffic data" }, { status: 500 });
  }
}
