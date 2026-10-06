import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { getUserPrefs } from "@/lib/db/repos/userPrefsRepo";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import { getSettings, getCombos, getProviderConnections } from "@/lib/localDb";
import { getUnavailableModelIds, getModelHealth } from "@/lib/modelHealth";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getPricingForModel } from "open-sse/providers/pricing.js";
import { getModelTier } from "@/sse/services/modelTiers.js";
import { getUsageStats } from "@/lib/db/repos/usageRepo.js";
import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";

export const dynamic = "force-dynamic";

const PROVIDER_ALIAS_TO_ID = Object.fromEntries(
  Object.entries(PROVIDER_ID_TO_ALIAS || {}).map(([id, alias]) => [alias, id]),
);

function providerFromModelId(modelId) {
  const alias = modelId.split("/")[0];
  if (alias === "cf") return "cloudflare-ai";
  return PROVIDER_ALIAS_TO_ID[alias] || alias;
}

function accountSummary(connections, provider, model) {
  const providerConnections = connections.filter((connection) => connection.provider === provider && connection.isActive !== false);
  const now = Date.now();
  const locked = providerConnections.filter((connection) => {
    const lock = connection[`modelLock_${model}`] || connection.rateLimitedUntil;
    return lock && new Date(lock).getTime() > now;
  });
  return { active: providerConnections.length, locked: locked.length };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const estimatedTokens = Math.max(0, Number(searchParams.get("tokens")) || 0);
    const needsVision = searchParams.get("vision") === "true";
    const bigContext = searchParams.get("bigContext") === "true";
    const claims = await verifyDashboardAuthToken((await cookies()).get("auth_token")?.value).catch(() => null);
    const [globalSettings, allCombos, unavailable, health, allConnections, usage] = await Promise.all([
      getSettings(), getCombos(), getUnavailableModelIds(), getModelHealth(), getProviderConnections(), getUsageStats("24h"),
    ]);
    const tenant = claims?.role === "moderator" && claims.username ? claims.username : null;
    const settings = tenant ? { ...globalSettings, ...Object.fromEntries(Object.entries(await getUserPrefs(tenant)).filter(([key]) => key.startsWith("jev"))) } : globalSettings;
    const allModels = await buildModelsList(["llm"], { skipDynamicFetch: true, ownerUsername: tenant });
    const connections = tenant ? allConnections.filter((connection) => connection.ownerUsername === tenant) : allConnections;
    const combos = tenant ? allCombos.filter((combo) => combo.ownerUsername === tenant) : allCombos;
    const scopedModels = allModels;
    const localCombo = combos.find((item) => item.name === "local-first");
    const activeIds = new Set(scopedModels
      .filter((item) => item.owned_by !== "combo" && item.owned_by !== "9router" && typeof item.id === "string" && item.id.includes("/"))
      .map((item) => item.id));
    const configuredPool = Array.isArray(settings.jevPoolModels) ? settings.jevPoolModels : [];
    const basePool = [...new Set(tenant ? [...activeIds, ...configuredPool.filter((id) => activeIds.has(id))] : [...activeIds, ...configuredPool])].filter((id) => typeof id === "string" && id.includes("/") && !["jev", "jev-1m", "jev-free"].includes(id.split("/").at(-1)));
    const localModels = new Set((localCombo?.models || []).map((item) => String(item).toLowerCase()));
    const unavailableCanonical = new Set([...unavailable].map((id) => {
      const slash = id.indexOf("/");
      return slash < 0 ? id : `${providerFromModelId(id)}/${id.slice(slash + 1)}`;
    }));
    const minContext = Number(settings.jev1mMinContext) || 200000;
    const rows = basePool.map((id) => {
      const [alias, ...rest] = id.split("/");
      const model = rest.join("/");
      const provider = providerFromModelId(id);
      const capabilities = getCapabilitiesForModel(provider, model) || {};
      const reasons = [];
      if (!activeIds.has(id)) reasons.push("Kein aktiver Provider/Modell-Eintrag");
      if (Array.isArray(settings.jevPoolModels) && !configuredPool.includes(id)) reasons.push("Nicht im Jev-Pool ausgewählt");
      if (id === "jev" || id === "nineRouter/jev" || !id.includes("/")) reasons.push("Kein konkretes Provider-Modell");
      if (model.toLowerCase().includes("haiku")) reasons.push("Haiku-Systemmodell");
      if (unavailableCanonical.has(`${provider}/${model}`)) reasons.push("Alle Accounts im Cooldown");
      if (estimatedTokens && Number(capabilities.contextWindow || 0) > 0 && Number(capabilities.contextWindow) < estimatedTokens + 1000) reasons.push("Context-Fenster zu klein");
      if (bigContext && Number(capabilities.contextWindow || 0) < minContext) reasons.push(`Jev-1m benötigt ${Math.round(minContext / 1000)}k Context`);
      if (needsVision && !capabilities.vision) reasons.push("Keine Vision-Unterstützung");
      if (!Array.isArray(settings.jevPoolModels) && settings.jevExcludeLocalModels !== false && (localModels.has(id.toLowerCase()) || localModels.has(model.toLowerCase()))) reasons.push("Teil von local-first");
      const account = accountSummary(connections, provider, model);
      const pricing = getPricingForModel(provider, model);
      return { id, provider, model, tier: getModelTier(id, settings.jevModelTiers) || "unknown", contextWindow: capabilities.contextWindow || null, vision: capabilities.vision === true, pricing: pricing || null, health: health[`${provider}/${model}`]?.state || "ok", account, excludedBy: reasons };
    });
    return NextResponse.json({
      inputs: { estimatedTokens, needsVision, bigContext },
      settings: { tierDistributionEnabled: settings.jevTierDistributionEnabled !== false, tierPreference: settings.jevTierPreference || "balanced", excludeLocalModels: settings.jevExcludeLocalModels !== false, jev1mMinContext: minContext, cacheTtlMs: settings.cacheJevTtlMs || 0 },
      sources: { poolMode: Array.isArray(settings.jevPoolModels) ? "Eigene Jev-Modellliste" : "Alle aktiven LLM-Modelle", freePoolMode: Array.isArray(settings.jevFreePoolModels) ? "Eigene Free-Modellliste" : "Alle aktiven Free/Flat-Rate Modelle", localFirst: localCombo?.models || [] },
      usage: { byProvider: Object.fromEntries(["claude", "glm", "codex"].map((provider) => [provider, usage.byProvider?.[provider] || {}])) },
      models: rows,
      freePoolModels: Array.isArray(settings.jevFreePoolModels) ? settings.jevFreePoolModels : null,
    });
  } catch (error) {
    console.error("[API] Jev picker data failed:", error);
    return NextResponse.json({ error: "Jev picker data unavailable" }, { status: 500 });
  }
}
