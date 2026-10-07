import { NextResponse } from "next/server";
import { getDistinctProviders } from "@/lib/requestDetailsDb";
import { getProviderConnections, getProviderNodes } from "@/lib/localDb";
import { getRequestUsername } from "@/lib/auth/requestUser";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";

/**
 * GET /api/usage/providers
 * Returns list of unique providers from request details
 */
export async function GET() {
  try {
    const username = await getRequestUsername();
    const visibleProviders = username
      ? new Set((await getProviderConnections({ ownerUsername: username })).map((connection) => connection.provider))
      : null;
    const providerIds = (await getDistinctProviders()).filter((providerId) => !visibleProviders || visibleProviders.has(providerId));

    const providerNodes = await getProviderNodes(username ? { ownerUsername: username } : {});
    const nodeMap = {};
    for (const node of providerNodes) {
      nodeMap[node.id] = node.name;
    }

    const providers = providerIds.map(providerId => {
      let name = providerId;
      if (nodeMap[providerId]) {
        name = nodeMap[providerId];
      } else {
        const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
        if (providerConfig?.name) name = providerConfig.name;
      }
      return { id: providerId, name };
    });

    return NextResponse.json({ providers });
  } catch (error) {
    console.error("[API] Failed to get providers:", error);
    return NextResponse.json(
      { error: "Failed to fetch providers" },
      { status: 500 }
    );
  }
}
