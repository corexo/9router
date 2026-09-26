import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
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
  selectJevModel,
} from "../services/jevRouter.js";
import { startJevTrace, tapJevResponse } from "@/lib/jev/requestLog.js";
import { sessionKey } from "@/lib/jev/sessionModels.js";
import { touchSessionCache, getSessionCacheMeta, clearSessionCacheByModel } from "@/lib/jev/sessionCache.js";
import { filterModelsByTierPreference } from "../services/modelTiers.js";
import { getUnavailableModelIds, recordModelFailure, recordModelSuccess, getModelHealth } from "@/lib/modelHealth.js";
import { clearSessionModelByModel } from "@/lib/jev/sessionModels.js";
import { clearCachedJevDecisionByModel } from "@/lib/jev/decisionCache.js";
import { getPricingForModel } from "open-sse/providers/pricing.js";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getUsageStats } from "@/lib/db/repos/usageRepo.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { stripThinkingSuffix } from "open-sse/translator/concerns/thinkingUnified.js";
import { estimateQoderPromptTokens } from "open-sse/shared/qoder/contextTier.js";
import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";

const PROVIDER_ALIAS_TO_ID = Object.fromEntries(
  Object.entries(PROVIDER_ID_TO_ALIAS || {}).map(([id, alias]) => [alias, id])
);

// Reverse alias map (ui alias -> canonical provider id) for capability lookups.
function providerFromModelId(modelId) {
  const alias = modelId.includes("/") ? modelId.split("/")[0] : modelId;
  // Registry providers may expose multiple aliases. PROVIDER_ID_TO_ALIAS only
  // carries the primary one; Workers AI clients commonly use the secondary `cf`.
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
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  let routedModel = modelStr;
  const isJev1m = JEV1M_MODEL_ALIASES.has(modelStr);
  if (isJev1m || JEV_MODEL_ALIASES.has(modelStr)) {
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
      // A combo named "jev" narrows the candidate pool to exactly its models;
      // without one, every active LLM stays a candidate. The pool is deliberately
      // NOT peak-hour filtered: Claude peak hours shape normal combo rotation
      // only, never Jev's own decision.
      // skipDynamicFetch: no slow upstream /models discovery per request
      const jevCombo = await getComboModels("jev");
      const allActiveModels = await buildModelsList(["llm"], { skipDynamicFetch: true });
      // Exclude combos from active models — Jev must only route to concrete provider models (with slash)
      const activeConcreteModels = allActiveModels.filter(
        (m) => m.owned_by !== "combo" && typeof m.id === "string" && m.id.includes("/")
      );
      const activeIds = new Set(activeConcreteModels.map((m) => m.id));

      let pool = Array.isArray(jevCombo) && jevCombo.length > 0
        ? jevCombo.filter((modelId) => !JEV_MODEL_ALIASES.has(modelId) && typeof modelId === "string" && modelId.includes("/"))
        : [...activeIds];
      // A combo may list models whose provider has no active credentials
      // (e.g. gh/* without a GitHub connection). Jev must never see those:
      // intersect with the active list; keep the raw combo only if the
      // intersection is empty so a registry hiccup cannot empty the pool.
      if (pool.length > 0 && activeIds.size > 0) {
        const intersected = pool.filter((modelId) => activeIds.has(modelId));
        if (intersected.length > 0) pool = intersected;
      }
      // Strict guarantee: Never pass any combo name to Jev as a candidate
      pool = pool.filter((modelId) => modelId.includes("/") && !JEV_MODEL_ALIASES.has(modelId));
      // Rough prompt estimate; context-overflow candidates are excluded so Jev
      // never routes a request to a model whose window is too small (#1957).
      const estimatedTokens = estimateQoderPromptTokens(body) + Number(body.max_tokens || body.max_completion_tokens || 0);
      availableModels = pool
        .filter((modelId) => !unavailableCanonicalIds.has(`${providerFromModelId(modelId)}/${modelId.slice(modelId.indexOf("/") + 1)}`))
        .filter((modelId) => {
          if (modelId === "jev" || modelId === "nineRouter/jev") return true;
          const caps = getCapabilitiesForModel(providerFromModelId(modelId), modelId.slice(modelId.indexOf("/") + 1));
          const window = Number(caps?.contextWindow) || 0;
          // Unknown window: keep candidate (Jev may still pick it); only exclude
          // models that are known to be too small.
          return window <= 0 || window >= estimatedTokens + 1000;
        });
      if (estimatedTokens > 0 && availableModels.length > 0) {
        log.info("JEV", `[9Router-Jev] Kontextfilter: ~${estimatedTokens} Tokens -> ${availableModels.length}/${pool.length} Modelle passen${jevCombo ? " (Combo 'jev')" : ""}`);
      }
      // jev-1m: Pool auf große Kontextfenster eingrenzen (KV-Cache-freundliche
      // Append-Only-Sessions). Fallback: Top-3 nach Kontext statt leerer Pool.
      if (isJev1m) {
        const minContext = Number(settings.jev1mMinContext) || 200000;
        const beforeBig = availableModels.length;
        const bigFiltered = availableModels.filter((modelId) => {
          const caps = getCapabilitiesForModel(providerFromModelId(modelId), modelId.slice(modelId.indexOf("/") + 1));
          return (Number(caps?.contextWindow) || 0) >= minContext;
        });
        if (bigFiltered.length > 0) {
          availableModels = bigFiltered;
          log.info("JEV", `[9Router-Jev] jev-1m Big-Context-Filter (>= ${minContext}): ${availableModels.length}/${beforeBig} Modelle`);
        } else {
          availableModels = [...availableModels]
            .map((modelId) => ({
              modelId,
              window: Number(getCapabilitiesForModel(providerFromModelId(modelId), modelId.slice(modelId.indexOf("/") + 1))?.contextWindow) || 0,
            }))
            .sort((a, b) => b.window - a.window)
            .slice(0, 3)
            .map((x) => x.modelId);
          log.warn("JEV", `[9Router-Jev] jev-1m: kein Modell >= ${minContext} -> Top-3 nach Kontextfenster: ${availableModels.join(", ")}`);
        }
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
      // "Modell-Klasse" slider (dashboard): restrict the pool to the tiers the
      // user allows (small only … frontier only). Applied after the context
      // filter and before Jev sees the candidates, so a cached decision for a
      // now-disallowed model is rejected by selectJevModel's pool check too.
      const tierFilter = filterModelsByTierPreference(availableModels, settings.jevTierPreference);
      if (tierFilter.applied) {
        availableModels = tierFilter.models;
        log.info("JEV", `[9Router-Jev] Modell-Klasse '${tierFilter.preference.id}' (${tierFilter.preference.tiers.join("/")}): ${availableModels.length} Modelle, ${tierFilter.dropped} ausgeschlossen`);
      } else if (tierFilter.preference.id !== "balanced" && availableModels.length > 0) {
        log.warn("JEV", `[9Router-Jev] [WARN] Modell-Klasse '${tierFilter.preference.id}' passt zu keinem verfügbaren Modell -> Filter ignoriert`);
      }

      // "Lokale Modelle ausschließen" (settings.jevExcludeLocalModels !== false):
      // Models configured in the 'local-first' combo are excluded from Jev's candidate pool.
      if (settings.jevExcludeLocalModels !== false) {
        const localComboModels = await getComboModels("local-first");
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
    } catch (error) {
      log.warn("JEV", `[9Router-Jev] [WARN] Modell-Registry nicht verfügbar: ${error?.message || error}`);
    }
    jevTraceId = startJevTrace({ model: body?.model, body: clientRawRequest?.body ?? body, mode: isJev1m ? "jev-1m" : "jev" });
    routedModel = await selectJevModel(body, availableModels, {
      traceId: jevTraceId,
      bigContext: isJev1m,
      apiKey: settings.jevApiKey,
      defaultModel: settings.jevDefaultModel,
      timeoutMs: settings.jevTimeoutMs,
      cacheJevTtlMs: settings.cacheJevTtlMs,
      tierPreference: settings.jevTierPreference,
      getThinkingLevels,
      providerFromModelId,
      warn: (message) => log.warn("JEV", message),
      info: (message) => log.info("JEV", `[9Router-Jev] ${message}`),
      debug: !!process.env.DEBUG_JEV || !!settings.jevDebug,
      enrichCriteria: settings.jevEnrichCriteria !== false,
      getPricingForModel,
      getCapabilitiesForModel,
      getModelHealth,
      getProviderConnections,
      getUsageStats,
    });
    // Fallback default must be resolvable (provider/model or combo); else first available.
    // routedModel may carry a Jev-picked thinking suffix "model(level)" — strip it before
    // resolving, since getModelInfo/capabilities lookups operate on the bare model id.
    const routedInfo = await getModelInfo(stripThinkingSuffix(routedModel));
    if (!routedInfo.provider && !(await getComboModels(stripThinkingSuffix(routedModel))) && availableModels.length > 0) {
      log.warn("JEV", `[9Router-Jev] [WARN] Fallback '${routedModel}' nicht auflösbar -> Fallback: ${availableModels[0]}`);
      routedModel = availableModels[0];
    }
    body.model = routedModel;
    if (clientRawRequest?.body) clientRawRequest.body.model = routedModel;
  }

  // Session-cache observability: feed the registry and expose an opaque meta
  // (SSE comment / response headers via tapJevResponse). The Jev path already
  // touched the registry inside selectJevModel; non-Jev requests are recorded here.
  const sessKey = sessionKey(body);
  if (sessKey) {
    if (!(isJev1m || JEV_MODEL_ALIASES.has(modelStr))) {
      touchSessionCache(sessKey, {
        model: routedModel,
        provider: providerFromModelId(routedModel),
        promptTokens: estimateQoderPromptTokens(body),
      });
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
  const comboModels = await getComboModels(routedModel);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[routedModel]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const peakModels = filterPeakHours(comboModels, getPeakForCombo(settings, routedModel));
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
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
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
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: routedModel,
      comboStrategy,
      comboStickyLimit
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
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: routedModel,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
    }));
  }

  // Extract thinking level from Jev-picked model suffix (e.g. "model(high)" -> "high")
  // Pass to chatCore via body for response headers
  const thinkingSuffix = routedModel.match(/\((\w+)\)$/)?.[1] || "";
  if (thinkingSuffix && !body.thinking_level) {
    body.thinking_level = thinkingSuffix;
  }

  return tap(handleSingleModelChat(body, routedModel, clientRawRequest, request, apiKey));
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      const requiredCapabilities = detectRequiredCapabilities(body);
      const peakModels = filterPeakHours(comboModels, getPeakForCombo(settings, modelStr));
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
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
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
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
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

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
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
    const chatSettings = await getSettings();
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
      }
    });

    if (result.success) return result.response;

    recordModelFailure({
      provider,
      model,
      connectionId: credentials.connectionId,
      status: result.status,
      message: result.error,
    });

    // If request failed with 413 or context window overflow, clear Jev decision cache
    // and session stickiness for this model so it is not picked again on next turn.
    if (result.status === 413 || String(result.error).toLowerCase().includes("context window limit") || String(result.error).toLowerCase().includes("exceeded this model context")) {
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
    const shouldFallback = provider === "antigravity" && quotaResetMs
      ? true
      : (await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs)).shouldFallback;

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
