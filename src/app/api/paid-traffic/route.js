import { NextResponse } from "next/server";
import { getPaidTrafficData, hydratePaidTraffic } from "@/lib/jev/paidTrafficBalancer.js";
import { getUsageStats } from "@/lib/db/repos/usageRepo.js";
import { getSettings, getProviderConnections } from "@/lib/localDb";
import { getRequestUsername } from "@/lib/auth/requestUser";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const username = await getRequestUsername();
    const settings = await getSettings();
    const accountBalanceEnabled = settings.accountBalanceEnabled === true;
    // Read the stored ledger even while disabled; do not poll providers or trigger Jev allocations.
    await hydratePaidTraffic();
    const [traffic, usage, visibleConnections] = await Promise.all([
      Promise.resolve(getPaidTrafficData()),
      getUsageStats("7d", username),
      username ? getProviderConnections({ ownerUsername: username }) : Promise.resolve([]),
    ]);
    const visibleIds = new Set(visibleConnections.map((connection) => connection.id));
    const scopedTraffic = username ? {
      ...traffic,
      snapshot: traffic.snapshot ? { ...traffic.snapshot, accounts: (traffic.snapshot.accounts || []).filter((account) => visibleIds.has(account.id)) } : null,
      entries: (traffic.entries || []).map((entry) => ({
        ...entry,
        accounts: (entry.accounts || []).filter((account) => visibleIds.has(account.id)),
        selection: Object.fromEntries(Object.entries(entry.selection || {}).filter(([id]) => visibleIds.has(id))),
      })),
    } : traffic;
    const accounts = Object.values(usage?.byAccount || {}).map((account) => ({
      provider: account.provider,
      account: account.accountName || account.connectionId,
      requests: account.requests || 0,
      tokens: (account.promptTokens || 0) + (account.completionTokens || 0),
      cost: account.cost || 0,
    })).filter((account) => account.cost > 0);
    return NextResponse.json({ accountBalanceEnabled, ...scopedTraffic, usage: accounts });
  } catch (error) {
    console.error("[API] Failed to get paid traffic data:", error);
    return NextResponse.json({ error: "Failed to fetch paid traffic data" }, { status: 500 });
  }
}
