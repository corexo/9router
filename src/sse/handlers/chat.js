import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getTenantRequestContext } from "../services/tenantContext.js";
import { getUserPrefs } from "@/lib/db/repos/userPrefsRepo.js";
import { getUserByUsername } from "@/lib/db/repos/usersRepo.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities, filterPeakHours, getPeakForCombo } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import {
  JEV_MODEL_ALIASES,
  JEV1M_MODEL_ALIASES,
  JEV_FREE_MODEL_ALIASES,
  selectJevModel,
} from "../services/jevRouter.js";
import { adjudicateProviderError } from "../services/providerErrorAdjudication.js";
import { startJevTrace, tapJevResponse } from "@/lib/jev/requestLog.js";
import {
  sessionKey,
  clearSessionModel,
  clearSessionModelByModel,
  recordSessionProviderFailure,
  clearSessionProviderFailure,
  getSessionPenalizedProviders,
} from "@/lib/jev/sessionModels.js";
import { touchSessionCache, setSessionProjectPath, getSessionCacheMeta, clearSessionCacheByModel, getSessionConnection, setSessionConnection, clearSessionConnection } from "@/lib/jev/sessionCache.js";
import { filterModelsByTierPreference } from "../services/modelTiers.js";
import { fitsJevContext } from "../services/jevContext.js";
import { getUnavailableModelIds, recordModelFailure, recordModelSuccess, getModelHealth } from "@/lib/modelHealth.js";
import { clearCachedJevDecisionByModel, clearCachedJevDecisionBySession } from "@/lib/jev/decisionCache.js";
import { getPricingForModel } from "open-sse/providers/pricing.js";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getUsageStats } from "@/lib/db/repos/usageRepo.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getUsageForProvider as fetchProviderUsage } from "open-sse/services/usage.js";
import { refreshPaidTrafficOnce, isPaidModel, accountUsageFingerprint, shouldRefreshPaidTraffic, getCachedPaidTrafficSnapshot, cachePaidTrafficSnapshot, getPaidTrafficDistribution, markPaidTrafficRequest, hydratePaidTraffic, getPaidTrafficData } from "@/lib/jev/paidTrafficBalancer.js";
import { getPricingForModel as getEffectivePricingForModel } from "@/lib/db/repos/pricingRepo.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { stripThinkingSuffix } from "open-sse/translator/concerns/thinkingUnified.js";
import { estimateQoderPromptTokens } from "open-sse/shared/qoder/contextTier.js";
import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";

const PROVIDER_ALIAS_TO_ID = Object.fromEntries(
  Object.entries(PROVIDER_ID_TO_ALIAS || {}).map(([id, alias]) => [alias, id])
);

// Reverse alias map (ui alias -> canonical provider id) for capability lookups.
function providerFromModelId(modelId) {
  if (!modelId) return null;
  if (!modelId.includes("/")) {
    if (modelId === "cf") return "cloudflare-ai";
    return PROVIDER_ALIAS_TO_ID[modelId] || null;
  }
  const alias = modelId.split("/")[0];
  if (alias === "cf") return "cloudflare-ai";
  return PROVIDER_ALIAS_TO_ID[alias] || alias;
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let jevTraceId = null; // 4-stage trace for the Jev Inspector (set when Jev routing runs)
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Support session ID via body (prompt_cache_key, session_id) or HTTP headers (x-pi-session-id, x-session-id, x-prompt-cache-key)
  const headerSessionId = request?.headers?.get("x-pi-session-id")
    || request?.headers?.get("x-session-id")
    || request?.headers?.get("x-prompt-cache-key");
  const clientSessionId = body?.prompt_cache_key
    || body?.session_id
    || body?.metadata?.session_id
    || body?.metadata?.conversation_id
    || headerSessionId
    || null;

  if (clientSessionId && body && typeof body === "object") {
    body.prompt_cache_key = clientSessionId;
  }

  // Support project path via body (pi_project_path, project_path) or HTTP header (x-pi-project-path)
  const headerProjectPath = request?.headers?.get("x-pi-project-path") || request?.headers?.get("x-project-path");
  const piProjectPath = body?.pi_project_path || body?.project_path || headerProjectPath || null;
  if (body && typeof body === "object") {
    delete body.pi_project_path;
    delete body.project_path;
  }
  if (clientRawRequest?.body && typeof clientRawRequest.body === "object") {
    delete clientRawRequest.body.pi_project_path;
    delete clientRawRequest.body.project_path;
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  // Claude Code marks a 1M-context request as `<model>[1m]`; the marker matches
  // no combo, alias or provider/model pair, so it must not reach resolution.
  // The capability travels in the anthropic-beta header, forwarded as-is.
  const { model: modelStr, contextMarker } = stripModelContextMarker(body.model);
  if (contextMarker) body.model = modelStr;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  const { apiKeyDetails, ownerUsername, tenantScoped } = await getTenantRequestContext(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  let settings = await getSettings();
  if (ownerUsername) {
    const owner = await getUserByUsername(ownerUsername);
    if (owner?.role === "moderator") {
      const userPrefs = await getUserPrefs(ownerUsername);
      const scopedSettings = { ...settings };
      for (const key of Object.keys(scopedSettings)) if (key.startsWith("jev") && key !== "jevApiKey") delete scopedSettings[key];
      settings = { ...scopedSettings, ...Object.fromEntries(Object.entries(userPrefs).filter(([key]) => key.startsWith("jev"))) };
    }
  }
  const accountBalanceEnabled = settings.accountBalanceEnabled === true;
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = !!apiKeyDetails || await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (tenantScoped && !ownerUsername) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "API key must be assigned to a user");

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  let routedModel = modelStr;
  const isJev1m = JEV1M_MODEL_ALIASES.has(modelStr);
  const isJevFree = JEV_FREE_MODEL_ALIASES.has(modelStr);
  if (isJevFree || isJev1m || JEV_MODEL_ALIASES.has(modelStr)) {
    let availableModels = [];
    try {
      const unavailableModels = await getUnavailableModelIds();
      // Health entries use canonical provider ids (e.g. claude), while candidates
      // often use UI aliases (e.g. cc). Compare canonical ids, otherwise a 429
      // lock does not remove cc/claude-* from Jev's next decision.
      const unavailableCanonicalIds = new Set([...unavailableModels].map((modelId) => {
        const slash = modelId.indexOf("/");
        if (slash < 0) return modelId;
        return `${providerFromModelId(modelId)}/${modelId.slice(slash + 1)}`;
      }));
      // An explicit pool list is authoritative; only an unset list uses every active LLM.
      // The pool is deliberately NOT peak-hour filtered.
      // skipDynamicFetch: no slow upstream /models discovery per request
      const configuredPool = Array.isArray(settings.jevPoolModels) ? settings.jevPoolModels : [];
      const allActiveModels = await buildModelsList(["llm"], { skipDynamicFetch: true, ownerUsername });
      // Exclude combos from active models — Jev must only route to concrete provider models (with slash)
      const activeConcreteModels = allActiveModels.filter(
        (m) => m.owned_by !== "combo" && m.owned_by !== "9router" && typeof m.id === "string" && m.id.includes("/")
      );
      const activeIds = new Set(activeConcreteModels.map((m) => m.id));

      // jev-free uses the separate jevFreePoolModels setting and skips paid-only / sticky logic.
      if (isJevFree) {
        const PAID_PROVIDERS = new Set(["claude", "anthropic", "codex", "chatgpt", "openai", "glm", "glm-cn", "zai"]);
        const freeConfiguredPool = Array.isArray(settings.jevFreePoolModels) ? settings.jevFreePoolModels : null;
        let freePool = freeConfiguredPool
          ? freeConfiguredPool.filter((id) => !JEV_FREE_MODEL_ALIASES.has(id) && typeof id === "string" && id.includes("/"))
          : [...activeIds].filter((id) => !PAID_PROVIDERS.has(providerFromModelId(id)));
        // Always restrict to active models with real credentials.
        freePool = freePool.filter((id) => activeIds.has(id));
        freePool = freePool.filter((id) => id.includes("/") && !JEV_FREE_MODEL_ALIASES.has(id) && !id.toLowerCase().includes("haiku"));
        const estimatedTokens = estimateQoderPromptTokens(body);
        availableModels = freePool
          .filter((id) => !unavailableCanonicalIds.has(`${providerFromModelId(id)}/${id.slice(id.indexOf("/") + 1)}`))
          .filter((id) => {
            const caps = getCapabilitiesForModel(providerFromModelId(id), id.slice(id.indexOf("/") + 1));
            return fitsJevContext(caps, estimatedTokens, body);
          });
        if (detectRequiredCapabilities(body).has("vision")) {
          availableModels = availableModels.filter((id) =>
            getCapabilitiesForModel(providerFromModelId(id), id.slice(id.indexOf("/") + 1)).vision
          );
        }
        log.info("JEV", `[9Router-Jev-Free] Pool: ${availableModels.length}/${freePool.length} Modelle${freeConfiguredPool ? " (konfiguriert)" : " (auto-free)"}`);
      } else {
        let pool = settings.jevPoolModels !== undefined && Array.isArray(settings.jevPoolModels)
          ? configuredPool.filter((modelId) => !JEV_MODEL_ALIASES.has(modelId) && typeof modelId === "string" && modelId.includes("/"))
          : [...activeIds];
        // Never offer configured models without active provider credentials.
        pool = pool.filter((modelId) => activeIds.has(modelId));
        // Strict guarantee: Never pass any combo name to Jev as a candidate; exclude Haiku models (system combo)
        pool = pool.filter((modelId) => modelId.includes("/") && !JEV_MODEL_ALIASES.has(modelId) && !modelId.toLowerCase().includes("haiku"));
        // Rough prompt estimate; context-overflow candidates are excluded so Jev
        // never routes a request to a model whose window is too small (#1957).
        const estimatedTokens = estimateQoderPromptTokens(body);
        availableModels = pool
          .filter((modelId) => !unavailableCanonicalIds.has(`${providerFromModelId(modelId)}/${modelId.slice(modelId.indexOf("/") + 1)}`))
          .filter((modelId) => {
            const caps = getCapabilitiesForModel(providerFromModelId(modelId), modelId.slice(modelId.indexOf("/") + 1));
            return fitsJevContext(caps, estimatedTokens, body);
          });
        if (estimatedTokens > 0 && availableModels.length > 0) {
          log.info("JEV", `[9Router-Jev] Kontextfilter: ~${estimatedTokens} Tokens -> ${availableModels.length}/${pool.length} Modelle passen${configuredPool.length ? " (eigene Jev-Modellliste)" : ""}`);
        }
        // Requests mit Bildinhalt brauchen ein vision-fähiges Ziel — Jev darf
        // nur Kandidaten sehen, die die Bilder auch verarbeiten können.
        if (detectRequiredCapabilities(body).has("vision")) {
          const beforeVision = availableModels.length;
          availableModels = availableModels.filter((modelId) => {
            if (modelId === "jev" || modelId === "nineRouter/jev") return true;
            return getCapabilitiesForModel(providerFromModelId(modelId), modelId.slice(modelId.indexOf("/") + 1)).vision;
          });
          log.info("JEV", `[9Router-Jev] Vision-Filter: ${availableModels.length}/${beforeVision} Modelle können Bilder verarbeiten`);
        }
        // The model-class preference is a soft Jev prompt hint only; it never removes candidates.
        if (settings.jevTierDistributionEnabled !== false) {
          const tierFilter = filterModelsByTierPreference(availableModels, settings.jevTierPreference);
          availableModels = tierFilter.models;
          log.info("JEV", `[9Router-Jev] Modell-Klasse '${tierFilter.preference.id}' als Präferenz; Pool bleibt vollständig (${availableModels.length} Modelle)`);
        }

        // Local-first exclusion applies only to the unconfigured default pool;
        // an explicit checkbox selection always wins.
        if (!Array.isArray(settings.jevPoolModels) && settings.jevExcludeLocalModels !== false) {
          const localComboModels = await getComboModels("local-first", ownerUsername);
          if (Array.isArray(localComboModels) && localComboModels.length > 0) {
            const localSet = new Set(localComboModels.map((m) => m.toLowerCase()));
            const beforeCount = availableModels.length;
            const filtered = availableModels.filter((modelId) => {
              const raw = modelId.toLowerCase();
              const bare = raw.includes("/") ? raw.slice(raw.indexOf("/") + 1) : raw;
              return !localSet.has(raw) && !localSet.has(bare);
            });
            if (filtered.length > 0) {
              const dropped = beforeCount - filtered.length;
              availableModels = filtered;
              if (dropped > 0) {
                log.info("JEV", `[9Router-Jev] Lokale Modelle ('local-first') ausgeschlossen: ${dropped} Modelle entfernt (${availableModels.length} verbleiben)`);
              }
            }
          }
        }

        // Filter out providers penalized for this session (e.g. Codex quota exhausted)
        const currentSessKey = sessionKey(body);
        const penalizedProviders = currentSessKey ? getSessionPenalizedProviders(currentSessKey) : new Set();
        if (penalizedProviders.size > 0) {
          const nonPenalized = availableModels.filter((m) => !penalizedProviders.has(providerFromModelId(m)));
          if (nonPenalized.length > 0) {
            log.info("JEV", `[FAILOVER] Session-Penalized Filter: excluded [${[...penalizedProviders].join(",")}], ${nonPenalized.length}/${availableModels.length} models remaining`);
            availableModels = nonPenalized;
          } else {
            log.warn("JEV", `[FAILOVER] All available models belong to penalized providers [${[...penalizedProviders].join(",")}], keeping full pool`);
          }
        }

        // If session had a failover (penalized providers active), prioritize GLM models
        if (penalizedProviders.size > 0 && availableModels.some((m) => providerFromModelId(m) === "glm" || m.startsWith("glm/"))) {
          availableModels.sort((a, b) => {
            const aIsGlm = providerFromModelId(a) === "glm" || a.startsWith("glm/");
            const bIsGlm = providerFromModelId(b) === "glm" || b.startsWith("glm/");
            if (aIsGlm && !bIsGlm) return -1;
            if (!aIsGlm && bIsGlm) return 1;
            return 0;
          });
        }
      }
    } catch (error) {
      log.warn("JEV", `[9Router-Jev] [WARN] Modell-Registry nicht verfügbar: ${error?.message || error}`);
      return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Jev-Modell-Pool konnte nicht sicher ermittelt werden");
    }
    if (availableModels.length === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Kein aktives Jev-Modell erfüllt Kontextbudget und erforderliche Fähigkeiten");
    jevTraceId = startJevTrace({ model: body?.model, body: clientRawRequest?.body ?? body, mode: isJev1m ? "jev-1m" : isJevFree ? "jev-free" : "jev" });
    const paidTraffic = accountBalanceEnabled ? await refreshPaidTrafficOnce(async () => {
      await hydratePaidTraffic();
      const paidModels = (await Promise.all(availableModels.map(async (id) => {
        const provider = providerFromModelId(id);
        const model = id.slice(id.indexOf("/") + 1);
        const pricing = id.includes("/") ? await getEffectivePricingForModel(provider, model) : null;
        return isPaidModel(id, providerFromModelId, () => pricing) ? id : null;
      }))).filter(Boolean);
      if (!paidModels.length) return null;
      const balancerAccounts = (await getProviderConnections(ownerUsername ? { ownerUsername } : {})).filter((c) => c.isActive !== false && ["codex", "chatgpt", "openai", "glm", "glm-cn", "zai", "claude", "anthropic"].includes(c.provider));
      const targetProvider = balancerAccounts.find((account) => paidModels.some((id) => providerFromModelId(id) === account.provider))?.provider;
      if (!targetProvider) return null;
      const accounts = balancerAccounts.filter((account) => account.provider === targetProvider);
      const usageSnapshot = await Promise.all(accounts.map(async (account) => {
        let usage = getCachedPaidTrafficSnapshot(account.provider);
        if (!usage) {
          try { usage = await fetchProviderUsage(account); cachePaidTrafficSnapshot(account.provider, usage); }
          catch { usage = null; }
        }
        const quota = usage?.quotas?.find?.((q) => /session|weekly|monthly|usage/i.test(q.name || q.label || "")) || usage?.[0] || {};
        return {
          id: account.id, provider: account.provider,
          account: account.displayName || account.name || account.email || account.id.slice(0, 8),
          used: quota.used ?? quota.usage ?? quota.consumed ?? null,
          limit: quota.limit ?? quota.total ?? null,
          resetAt: quota.resetAt ?? quota.reset_at ?? null,
          sessionStartedAt: usage?.sessionStartedAt ?? null,
          sessionDurationMs: usage?.sessionDurationMs ?? null,
          usageUpdatedAt: usage?.updatedAt ?? usage?.timestamp ?? null,
          available: account.isActive !== false && account.testStatus !== "unavailable",
        };
      }));
      const snapshot = { provider: targetProvider, accounts: usageSnapshot, lastRequestedAt: getPaidTrafficData().lastRequestedAt, fingerprint: getPaidTrafficData().snapshot?.fingerprint };
      const fingerprint = accountUsageFingerprint(usageSnapshot);
      const previousDistribution = getPaidTrafficDistribution(targetProvider);
      if (!shouldRefreshPaidTraffic(snapshot, fingerprint)) {
        return previousDistribution ? { provider: targetProvider, accounts: usageSnapshot, selection: previousDistribution, cached: true } : null;
      }
      const requestData = { purpose: "allocation", provider: targetProvider, usage: usageSnapshot, instruction: "Return a JSON object mapping only supplied account IDs to traffic weights from 0 to 100; weights must sum to 100. Consider usage, session duration/context cache, and each quota resetAt. Do not invent accounts or trigger resets." };
      return { provider: targetProvider, accounts: usageSnapshot, request: requestData };
    }) : null;
    routedModel = await selectJevModel(body, availableModels, {
      traceId: jevTraceId,
      bigContext: isJev1m,
      apiKey: settings.jevApiKey,
      usageApiKey: apiKey || null,
      defaultModel: settings.jevDefaultModel,
      timeoutMs: settings.jevTimeoutMs,
      cacheJevTtlMs: isJevFree ? 0 : settings.cacheJevTtlMs, // no cache for one-shot subagent tasks
      tierPreference: settings.jevTierPreference,
      tierDistributionEnabled: isJevFree ? false : settings.jevTierDistributionEnabled !== false,
      overrideInstructions: isJevFree ? "Route this subagent or short one-shot task to the fastest, cheapest available model from the provided candidates. Prefer zero-cost or flat-rate models. Prompt caching and session stickiness are irrelevant — just pick the best available free/flat-rate model for the current request." : undefined,
      modelTierOverrides: settings.jevModelTiers || {},
      getThinkingLevels,
      providerFromModelId,
      warn: (message) => log.warn("JEV", message),
      info: (message) => log.info("JEV", `[9Router-Jev] ${message}`),
      debug: !!process.env.DEBUG_JEV || !!settings.jevDebug,
      enrichCriteria: settings.jevEnrichCriteria !== false,
      getPricingForModel: (provider, model) => getEffectivePricingForModel(provider, model),
      getCapabilitiesForModel,
      getModelHealth,
      getProviderConnections: async (filter = {}) => {
        const connections = await getProviderConnections(filter);
        return ownerUsername ? connections.filter((connection) => connection.ownerUsername === ownerUsername) : connections;
      },
      getUsageStats,
      paidTrafficDistribution: accountBalanceEnabled && !isJevFree && (paidTraffic?.request ? { ...paidTraffic, persistRequest: () => markPaidTrafficRequest({ provider: paidTraffic.provider, accounts: paidTraffic.accounts }, paidTraffic.request) } : paidTraffic),
    });
    // Fallback default must be resolvable (provider/model or combo); else first available.
    const cleanRouted = routedModel ? stripThinkingSuffix(routedModel) : null;
    const routedInfo = cleanRouted ? await getModelInfo(cleanRouted, { ownerUsername }) : { provider: null };
    if ((!routedInfo.provider && !(await getComboModels(cleanRouted, ownerUsername))) && availableModels.length > 0) {
      log.warn("JEV", `[9Router-Jev] [WARN] Fallback '${routedModel}' nicht auflösbar -> Fallback: ${availableModels[0]}`);
      routedModel = availableModels[0];
    }
    if (!routedModel && availableModels.length > 0) {
      routedModel = availableModels[0];
    }
    if (!routedModel) {
      log.warn("JEV", `[9Router-Jev] [WARN] Kein passendes Modell für diesen Request verfügbar`);
      return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Kein Modell mit ausreichendem Kontextfenster oder verfügbarer Quote gefunden.");
    }
    body.model = routedModel;
    if (clientRawRequest?.body) clientRawRequest.body.model = routedModel;
  }

  // Session-cache observability: feed the registry and expose an opaque meta
  // (SSE comment / response headers via tapJevResponse). The Jev path already
  // touched the registry inside selectJevModel; non-Jev requests are recorded here.
  const sessKey = sessionKey(body);
  if (sessKey) {
    const isConcrete = typeof routedModel === "string" && routedModel.includes("/");
    const resolvedProvider = providerFromModelId(routedModel);
    // Keep lightweight probePrefix (first 2-4 messages) so keep-alive daemon can refresh prompt cache upstream
    const probeMessages = Array.isArray(body?.messages)
      ? body.messages.filter((m) => m?.role === "system" || m?.role === "developer").slice(0, 2)
        .concat(body.messages.filter((m) => m?.role !== "system" && m?.role !== "developer").slice(0, 2))
        .map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? m.content.filter(p => p?.type === "text") : ""),
        }))
      : null;

    if (!(isJev1m || JEV_MODEL_ALIASES.has(modelStr))) {
      touchSessionCache(sessKey, {
        piProjectPath,
        model: isConcrete ? routedModel : null,
        provider: resolvedProvider,
        promptTokens: estimateQoderPromptTokens(body),
        probePrefix: probeMessages ? { messages: probeMessages, model: routedModel, provider: resolvedProvider } : undefined,
      });
    } else {
      // Keep Jev's existing probePrefix update; the display path is independent.
      if (probeMessages) touchSessionCache(sessKey, {
        probePrefix: { messages: probeMessages, model: routedModel, provider: resolvedProvider },
      });
      setSessionProjectPath(sessKey, piProjectPath);
    }
  }
  const cacheMeta = sessKey ? getSessionCacheMeta(sessKey) : null;
  const tap = (response) => tapJevResponse(response, jevTraceId, cacheMeta);

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, routedModel, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return tap(bypassResponse.response || bypassResponse);

  const requiredCapabilities = detectRequiredCapabilities(body);

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(routedModel, ownerUsername);
  if (comboModels) {
    // A combo can outlive a retired upstream model. Health locks are authoritative
    // for every router path, not only Jev, so a 410 is never retried by compaction.
    const unavailableModels = await getUnavailableModelIds();
    const healthyComboModels = comboModels.filter((id) => !unavailableModels.has(id));
    if (healthyComboModels.length === 0) {
      return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, `No healthy models in combo: ${routedModel}`);
    }
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[routedModel]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const peakModels = filterPeakHours(healthyComboModels, getPeakForCombo(settings, routedModel));
    const augmentedModels = augmentModelsWithCapacityAdapter(peakModels, requiredCapabilities, settings);
    const adapterAdded = augmentedModels.filter((m) => !peakModels.includes(m));

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${routedModel}" with ${peakModels.length} models (strategy: fusion)`);
      return tap(handleFusionChat({
        body,
        models: peakModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, ownerUsername);
        },
        log,
        comboName: routedModel,
        judgeModel: comboStrategies[routedModel]?.judgeModel,
        tuning: comboStrategies[routedModel]?.fusionTuning,
      }));
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${routedModel}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return tap(handleComboChat({
      body,
      models: augmentedModels,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, ownerUsername),
        adapterAdded
      ),
      log,
      comboName: routedModel,
      comboStrategy,
      comboStickyLimit,
      providerBalancer: accountBalanceEnabled ? settings.providerBalancer : null,
    }));
  }

  // Single model request — may still switch to a capacity-adapter model if the
  // target lacks a capability the request needs (e.g. no vision, request has an image).
  const soloAugmented = augmentModelsWithCapacityAdapter([routedModel], requiredCapabilities, settings);
  if (soloAugmented.length > 1) {
    const adapterAdded = soloAugmented.filter((m) => m !== routedModel);
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${routedModel}" → trying ${soloAugmented.join(", ")}`);
    return tap(handleComboChat({
      body,
      models: soloAugmented,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, ownerUsername),
        adapterAdded
      ),
      log,
      comboName: routedModel,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings),
      providerBalancer: accountBalanceEnabled ? settings.providerBalancer : null,
    }));
  }

  // Extract thinking level from Jev-picked model suffix (e.g. "model(high)" -> "high")
  // Pass to chatCore via body for response headers
  const thinkingSuffix = routedModel.match(/\((\w+)\)$/)?.[1] || "";
  if (thinkingSuffix && !body.thinking_level) {
    body.thinking_level = thinkingSuffix;
  }

  return tap(handleSingleModelChat(body, routedModel, clientRawRequest, request, apiKey, ownerUsername));
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, ownerUsername = null) {
  const modelInfo = await getModelInfo(modelStr, { ownerUsername });

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr, ownerUsername);
    if (comboModels) {
      const unavailableModels = await getUnavailableModelIds();
      const healthyComboModels = comboModels.filter((id) => !unavailableModels.has(id));
      if (healthyComboModels.length === 0) {
        return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, `No healthy models in combo: ${modelStr}`);
      }
      let chatSettings = await getSettings();
      if (apiKey) {
        const keyDetails = (await getTenantRequestContext(request)).apiKeyDetails;
        if (keyDetails?.ownerUsername) {
          const userPrefs = await getUserPrefs(keyDetails.ownerUsername);
          chatSettings = { ...chatSettings, ...Object.fromEntries(Object.entries(userPrefs).filter(([key]) => key.startsWith("jev"))) };
        }
      }
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      const requiredCapabilities = detectRequiredCapabilities(body);
      const peakModels = filterPeakHours(healthyComboModels, getPeakForCombo(settings, modelStr));
      const augmentedModels = augmentModelsWithCapacityAdapter(peakModels, requiredCapabilities, chatSettings);
      const adapterAdded = augmentedModels.filter((m) => !peakModels.includes(m));

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${peakModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: peakModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, ownerUsername);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, ownerUsername),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let errorAdjudications = 0;
  const sessKey = sessionKey(body);
  const preferredConnectionId = sessKey ? getSessionConnection(sessKey) : null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, {
      preferredConnectionId: excludeConnectionIds.size === 0 ? preferredConnectionId : null,
      ...(ownerUsername ? { ownerUsername, tenantScoped: true } : {}),

    });

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (sessKey) {
        clearSessionConnection(sessKey);
        const { triggered, count } = recordSessionProviderFailure(sessKey, provider);
        if (triggered) {
          clearSessionModel(sessKey);
          clearCachedJevDecisionBySession(sessKey);
          log.warn("FAILOVER", `[FAILOVER] Session ${sessKey.slice(0, 8)} exceeded failure threshold (${count}) on provider '${provider}'. Evicting sticky model and penalizing provider for session.`);
        }
      }
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    let chatSettings = await getSettings();
    const apiKeyDetails = apiKey ? (await getTenantRequestContext(request)).apiKeyDetails : null;
    if (apiKeyDetails?.ownerUsername) {
      const owner = await getUserByUsername(apiKeyDetails.ownerUsername);
      if (owner) {
        const userPrefs = await getUserPrefs(apiKeyDetails.ownerUsername);
        chatSettings = {
          ...chatSettings,
          rtkEnabled: true,
          headroomEnabled: false,
          headroomUrl: DEFAULT_HEADROOM_URL,
          headroomCompressUserMessages: false,
          headroomTimeoutMs: 3000,
          cavemanEnabled: false,
          cavemanLevel: "full",
          ponytailEnabled: false,
          ponytailLevel: "full",
          pxpipeEnabled: false,
          pxpipeMinChars: 25000,
          pxpipeTimeoutMs: 15000,
          ...Object.fromEntries(Object.entries(userPrefs).filter(([key]) => key.startsWith("rtk") || key.startsWith("headroom") || key.startsWith("caveman") || key.startsWith("ponytail") || key.startsWith("pxpipe") || key.startsWith("jev"))),
        };
      }
    }
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      headroomTimeoutMs: chatSettings.headroomTimeoutMs,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
        recordModelSuccess(provider, model);
        // "Consecutive" strikes: a success clears the breaker for this pair.
        clearAntigravityStrikes(credentials.connectionId, model);
        if (sessKey) {
          clearSessionProviderFailure(sessKey, provider);
          if (credentials.connectionId) {
            setSessionConnection(sessKey, credentials.connectionId);
          }
          // Ensure session probePrefix has the concrete downstream provider/model (resolving combos)
          const singleProbeMsgs = Array.isArray(body?.messages)
            ? body.messages.filter((m) => m?.role === "system" || m?.role === "developer").slice(0, 2)
              .concat(body.messages.filter((m) => m?.role !== "system" && m?.role !== "developer").slice(0, 2))
              .map((m) => ({
                role: m.role,
                content: typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? m.content.filter(p => p?.type === "text") : ""),
              }))
            : null;
          if (singleProbeMsgs && singleProbeMsgs.length > 0) {
            touchSessionCache(sessKey, {
              model: `${provider}/${model}`,
              provider,
              probePrefix: { messages: singleProbeMsgs, model: `${provider}/${model}`, provider },
            });
          }
        }
      }
    });

    if (result.success) return result.response;

    // Persist permanent/cooldown locks before this request can retry or a new
    // Jev selection reads the pool. Otherwise unsupported models remain eligible.
    await recordModelFailure({
      provider,
      model,
      connectionId: credentials.connectionId,
      status: result.status,
      message: result.error,
    });

    // Check if failure is rate limit (429) or quota exhausted and record failure for session
    if (sessKey && (result.status === 429 || result.status === 402 || result.status === 403 || String(result.error).toLowerCase().includes("quota") || String(result.error).toLowerCase().includes("rate limit"))) {
      // Quota exhaustion cannot recover within the same session retry window.
      // Evict this provider immediately so the client's retry gets another route.
      const { triggered, count } = recordSessionProviderFailure(sessKey, provider, 1);
      if (triggered) {
        clearSessionModel(sessKey);
        clearCachedJevDecisionBySession(sessKey);
        clearSessionConnection(sessKey);
        log.warn("FAILOVER", `[FAILOVER] Session ${sessKey.slice(0, 8)} reached ${count} quota/rate-limit failures on provider '${provider}'. Evicting sticky model and penalizing provider for session.`);
      }
    }

    // If request failed with 413 or context window overflow, clear Jev decision cache
    // and session stickiness for this model so it is not picked again on next turn.
    if (result.status === 413 || /context window limit|exceeds the context window|exceeded this model context|prompt token count|model_max_prompt_tokens_exceeded/i.test(String(result.error))) {
      clearSessionModelByModel(model);
      clearSessionModelByModel(`${provider}/${model}`);
      clearCachedJevDecisionByModel(model);
      clearCachedJevDecisionByModel(`${provider}/${model}`);
      clearSessionCacheByModel(model);
      clearSessionCacheByModel(`${provider}/${model}`);
    }

    // Antigravity 409/429: refresh live quota to get exact resetAt before locking
    let quotaResetMs = null;
    let resetsAtMs = result.resetsAtMs;
    if (provider === "antigravity" && (result.status === 409 || result.status === 429)) {
      quotaResetMs = await handleAntigravityQuotaError(
        credentials.connectionId, result.status, model,
        refreshedCredentials.accessToken, credentials.providerSpecificData
      );
      if (quotaResetMs) resetsAtMs = quotaResetMs;
    }

    // Exhausted Antigravity model is blocked only in RAM cache until upstream resetAt.
    // Do not persist a modelLock_* for this path.
    let shouldFallback = provider === "antigravity" && quotaResetMs
      ? true
      : (await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs)).shouldFallback;

    // Jev only adjudicates ambiguous errors, once per request. Obvious Gemini
    // free-tier exhaustion is classified locally and never retried on this account.
    if (!shouldFallback && errorAdjudications === 0 && result.status >= 400 && result.status < 500
      && !/context|invalid request|malformed|unsupported/i.test(String(result.error))) {
      errorAdjudications += 1;
      const adjudication = await adjudicateProviderError({
        provider, model, status: result.status, error: result.error,
        eligibleModels: [], apiKey: chatSettings.jevApiKey,
      });
      if (adjudication?.action === "next_account") {
        // Persist a bounded lock before moving to the next eligible account.
        shouldFallback = (await markAccountUnavailable(credentials.connectionId, 429, result.error, provider, model)).shouldFallback;
      }
    }

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
