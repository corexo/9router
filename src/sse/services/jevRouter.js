import { estimateTextTokens, extractTokens as extractJevTokens, recordJevUsage } from "@/lib/jev/client.js";
import { logJevRequest, updateLastJevRequest } from "@/lib/jev/requestLog.js";
import { getSessionModel, sessionKey, setSessionModel } from "@/lib/jev/sessionModels.js";
import { getCachedJevDecision, setCachedJevDecision } from "@/lib/jev/decisionCache.js";
import { getModelTier, TIER_DESCRIPTIONS } from "@/sse/services/modelTiers.js";
const JEV_API_URL = process.env.JEV_API_URL || "https://jev-ai.pro/api/v1/systemone";
const MODEL_QUESTION_ID = "target_model";
const THINKING_QUESTION_ID = "target_thinking";
const JEV_MODEL = "jev-1.13.0";
const DEFAULT_TIMEOUT_MS = 4500;
const MAX_PROMPT_LENGTH = 3000;
// Generic scale offered to Jev before we know which model it will pick;
// resolveThinkingSuffix() below clamps the answer to what the chosen model actually supports.
const GENERIC_THINKING_LEVELS = ["none", "low", "medium", "high", "xhigh"];
const THINKING_CRITERIA = {
  none: "Trivial request — no reasoning needed, fastest/cheapest response.",
  low: "Simple, well-defined task with little ambiguity.",
  medium: "Moderate complexity, some multi-step reasoning.",
  high: "Hard problem: non-trivial debugging, architecture, multi-file reasoning.",
  xhigh: "Very hard problem: deep multi-step reasoning, security-critical or high-stakes correctness.",
};

export const JEV_MODEL_ALIASES = new Set(["jev", "nineRouter/jev"]);

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function extractJevPrompt(body) {
  if (typeof body?.input === "string") return body.input.slice(0, MAX_PROMPT_LENGTH);

  const entries = Array.isArray(body?.messages)
    ? body.messages
    : Array.isArray(body?.input) ? body.input : [];
  const userEntries = entries.filter((entry) => entry?.role === "user");
  const selected = userEntries.at(-1) || entries.at(-1);
  return textFromContent(selected?.content).slice(0, MAX_PROMPT_LENGTH);
}

/**
 * Session stats Jev needs on top of the last prompt: how big the conversation
 * already is (context-window fit) and which model answered last (prompt-cache
 * stickiness). previousModel is only reliable if the client sends it explicitly —
 * plain OpenAI messages carry no model id.
 */
export function extractSessionContext(body) {
  const messages = Array.isArray(body?.messages)
    ? body.messages
    : Array.isArray(body?.input) ? body.input : [];

  const totalChars = messages.reduce((sum, message) => sum + textFromContent(message?.content).length, 0);
  const lastAssistant = messages.filter((message) => message?.role === "assistant").at(-1);
  // Clients rarely send a model id back, so fall back to 9Router's own memory of
  // what this conversation was routed to last turn.
  const previousModel = body?.metadata?.previous_model
    ?? body?.previous_model
    ?? lastAssistant?.model
    ?? getSessionModel(sessionKey(body))
    ?? null;

  return {
    approxTotalTokens: Math.ceil(totalChars / 4),
    historyTurns: messages.length,
    previousModel: typeof previousModel === "string" && previousModel.trim() ? previousModel.trim() : null,
  };
}

// SystemOne expects `state` as a string, so session stats ride along as a header.
function buildJevState(body, session) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const currentUserIndex = messages.findLastIndex((message) => message?.role === "user");
  const priorContext = currentUserIndex > 0
    ? messages
      .slice(0, currentUserIndex)
      .filter((message) => message?.role === "user" || message?.role === "assistant")
      .slice(-2)
      .map((message) => `${message.role}: ${textFromContent(message.content).slice(0, 1000)}`)
      .join("\n")
    : "none";

  return [
    "[9Router session context]",
    `Approx total tokens: ${session.approxTotalTokens}`,
    `History turns: ${session.historyTurns}`,
    `Previous model: ${session.previousModel || "unknown"}`,
    "Important: session size only determines context-window compatibility; it does not mean the current task is difficult.",
    "[Recent conversation context]",
    priorContext,
    "[Current user request]",
    extractJevPrompt(body),
  ].join("\n");
}

function resolveTimeout(configured) {
  const value = Number.parseInt(configured ?? process.env.JEV_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

// SystemOne takes choices as a criteria map, not an options array.
export function buildCriteria(models) {
  return Object.fromEntries(models.map((model) => [model, `Route to ${model}`]));
}

/**
 * Build criteria with cost, success rate, and account status for better Jev decisions.
 * options: { getPricingForModel, getModelHealth, getProviderConnections, getUsageStats }
 */
async function buildEnrichedCriteria(models, options = {}, session = {}) {
  if (!options.getPricingForModel || !options.getModelHealth) return buildCriteria(models);

  const result = {};
  const health = await options.getModelHealth?.().catch(() => ({}));
  const connections = await options.getProviderConnections?.().catch(() => []);
  const stats = await options.getUsageStats?.().catch(() => ({ byModel: {} }));

  const groupSizes = new Map();
  for (const model of models) {
    const provider = options.providerFromModelId ? options.providerFromModelId(model) : model.split("/")[0];
    groupSizes.set(provider, (groupSizes.get(provider) || 0) + 1);
  }

  for (const model of models) {
    const slashIdx = model.indexOf("/");
    const bareModel = slashIdx >= 0 ? model.slice(slashIdx + 1) : model;
    const alias = slashIdx >= 0 ? model.slice(0, slashIdx) : model;
    const provider = options.providerFromModelId ? options.providerFromModelId(model) : alias;

    let desc = model;
    const healthKey = `${provider}/${bareModel}`;
    const healthEntry = health[healthKey];

    if (healthEntry?.state === "disabled") {
      desc = `${model} | Status: DISABLED (${healthEntry.reason})`;
    } else if (healthEntry?.state === "incompatible") {
      desc = `${model} | Status: INCOMPATIBLE (schema issue)`;
    } else {
      const pricing = options.getPricingForModel?.(provider, bareModel);
      const costStr = pricing
        ? `$${pricing.input.toFixed(2)}/1M in, $${pricing.output.toFixed(2)}/1M out`
        : "Subscription/flat-rate (no per-token cost)";

      const providerConnections = connections.filter((c) => c.provider === provider || c.providerId === provider);
      const activeLimits = providerConnections
        .map((connection) => new Date(connection.rateLimitedUntil || 0).getTime())
        .filter((untilMs) => untilMs > Date.now());
      const groupStr = `Provider group: ${provider} (${groupSizes.get(provider)} available models)`;
      let quotaStr = "Provider quota: OK";
      if (activeLimits.length === providerConnections.length && activeLimits.length > 0) {
        const secsLeft = Math.ceil((Math.min(...activeLimits) - Date.now()) / 1000);
        quotaStr = `Provider quota: all accounts rate-limited (${secsLeft}s)`;
      } else if (activeLimits.length > 0) {
        quotaStr = `Provider quota: ${activeLimits.length}/${providerConnections.length} accounts rate-limited`;
      }

      const statsKey = `${bareModel} (${provider})`;
      const modelStats = stats.byModel?.[statsKey];
      const usageStr = modelStats?.requests ? `Model usage: ${modelStats.requests} requests recently` : "Model usage: none recently";
      const providerStats = stats.byProvider?.[provider];
      const groupUsageStr = providerStats?.requests
        ? `Group usage: ${providerStats.requests} requests, ${Math.round((providerStats.promptTokens || 0) / 1000)}k in / ${Math.round((providerStats.completionTokens || 0) / 1000)}k out recently`
        : "Group usage: none recently";

      const tier = getModelTier(bareModel);
      const tierStr = tier ? `${tier.toUpperCase()}: ${TIER_DESCRIPTIONS[tier]}` : "Tier: unknown";

      const window = Number(options.getCapabilitiesForModel?.(provider, bareModel)?.contextWindow) || 0;
      const contextStr = window > 0 ? `Context: ${Math.round(window / 1000)}k` : "Context: unknown";
      const stickyStr = session.previousModel === model ? "Sticky: YES" : "Sticky: NO";

      desc = `${tierStr} | ${groupStr} | Cost: ${costStr} | ${contextStr} | ${stickyStr} | ${usageStr} | ${groupUsageStr} | ${quotaStr}`;
    }

    result[model] = desc;
  }

  return result;
}

// Response shape is not contractually fixed; accept the documented nestings.
function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function pickAnswer(data, questionId) {
  const node = data?.results?.[questionId] ?? data?.answers?.[questionId] ?? data?.[questionId];
  const value = typeof node === "object" && node !== null
    ? (node.choice ?? node.selected ?? node.answer ?? node.value)
    : node;
  return typeof value === "string" ? value.trim() : undefined;
}

// Clamp Jev's generic thinking answer to what the chosen model actually supports.
// getThinkingLevels: injectable so tests don't need the real capabilities registry.
function resolveThinkingSuffix(rawLevel, chosenModel, options) {
  if (!rawLevel) return "";
  const level = String(rawLevel).trim().toLowerCase();
  if (!GENERIC_THINKING_LEVELS.includes(level)) return "";

  const getLevels = options.getThinkingLevels;
  if (typeof getLevels !== "function") {
    console.error("[JEV-DEBUG] getThinkingLevels not a function for", chosenModel);
    return "";
  }

  const provider = options.providerFromModelId?.(chosenModel) ?? chosenModel.split("/")[0];
  const bareModel = chosenModel.includes("/") ? chosenModel.slice(chosenModel.indexOf("/") + 1) : chosenModel;
  const supported = getLevels(provider, bareModel);
  if (!Array.isArray(supported) || supported.length === 0) {
    console.error("[JEV-DEBUG] No supported levels for", provider, bareModel, "got:", supported);
    return ""; // model has no reasoning capability at all
  }

  if (supported.includes(level)) {
    console.log("[JEV-DEBUG] Level supported:", level, "for", chosenModel);
    return `(${level})`;
  }
  // If model requires thinking (can't disable to none), pick lowest available level
  if (level === "none" && !supported.includes("none")) {
    // Normalize provider-specific thinking levels to generic scale (e.g. GLM's "thinking"→"high")
    const LEVEL_ALIASES = { thinking: "high" };
    const normalized = supported.map(l => LEVEL_ALIASES[l] || l);
    const scale = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
    const minLevel = normalized.sort((a, b) => scale.indexOf(a) - scale.indexOf(b))[0];
    console.log("[JEV-DEBUG] Fallback none -> minLevel:", minLevel, "for", chosenModel, "supported:", supported, "normalized:", normalized);
    return minLevel ? `(${minLevel})` : "";
  }
  if (level === "none") return ""; // model explicitly supports disabling thinking

  // Clamp to nearest supported level on the shared low->high scale.
  const scale = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const wanted = scale.indexOf(level);
  const ranked = supported
    .map((l) => ({ l, d: Math.abs(scale.indexOf(l) - wanted) }))
    .filter((entry) => entry.d >= 0)
    .sort((a, b) => a.d - b.d);
  return ranked[0] ? `(${ranked[0].l})` : "";
}

/**
 * options: { apiKey, defaultModel, timeoutMs, getThinkingLevels, providerFromModelId } —
 * UI settings win, env is the fallback. getThinkingLevels/providerFromModelId are injected
 * by the caller (real capabilities registry in production, mocks in tests).
 */
export async function selectJevModel(body, availableModels, options = {}) {
  const models = [...new Set(availableModels)].filter((model) => !JEV_MODEL_ALIASES.has(model));
  const apiKey = options.apiKey || process.env.TYPESAFE_API_KEY || "";
  const fallback = options.defaultModel || process.env.JEV_ROUTER_DEFAULT_MODEL || models[0];
  const warn = options.warn || console.warn;
  const fail = (reason) => {
    warn(`[9Router-Jev] [WARN] ${reason} -> Fallback: ${fallback}`);
    updateLastJevRequest({ fallbackUsed: fallback, fallbackReason: reason });
    return fallback;
  };

  if (models.length === 0) return fail("Keine verfügbaren Modelle");
  if (!apiKey) return fail("Jev API Key fehlt");

  // Check decision cache before hitting API
  const estimatedTokens = body.max_tokens || body.max_completion_tokens || 0;
  const session = extractSessionContext(body);
  const sessKey = sessionKey(body);
  const cached = getCachedJevDecision(sessKey, estimatedTokens, options.cacheJevTtlMs);
  if (cached && cached.model && models.includes(cached.model)) {
    options.info?.(`[JEV-CACHE] Hit: ${cached.model} (thinking: ${cached.thinking || "none"})`);
    updateLastJevRequest({ cachedModel: cached.model, cached: true });
    recordJevUsage({
      endpoint: "model-router",
      caller: options.caller || "model-router",
      questionType: "choice",
      status: "cached",
      httpStatus: 200,
      latencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      choice: cached.model,
    });
    return cached.model;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), resolveTimeout(options.timeoutMs));
  const jevStarted = Date.now();
  const logUsage = (result) => recordJevUsage({
    endpoint: "model-router",
    caller: options.caller || "model-router",
    questionType: "choice",
    status: result.status,
    httpStatus: result.httpStatus,
    latencyMs: Date.now() - jevStarted,
    promptTokens: result.promptTokens || 0,
    completionTokens: result.completionTokens || 0,
    choice: result.choice,
    fallbackReason: result.fallbackReason,
  });
  try {
    const criteria = options.enrichCriteria
      ? await buildEnrichedCriteria(models, options, session)
      : buildCriteria(models);

    const payload = {
      state: buildJevState(body, session),
      model: JEV_MODEL,
      questions: {
        [MODEL_QUESTION_ID]: {
          type: "choice",
          instructions: "Which model should handle this coding-agent request best? Judge difficulty from the current request and recent conversation context, never from session size. Session size only determines context-window compatibility. Short acknowledgements and simple follow-ups should use FAST or MID models. Each option lists its quality tier, per-token cost, context window, stickiness, recent usage and account status. Respect context-window limits against the session's approx total tokens. Prefer 'Sticky: YES' when its tier is sufficient, to keep prompt caching and style consistency. Avoid rate-limited accounts. Models sharing a tier are roughly equal in strength - prefer the cheaper or less-used one within a tier, and only go to a higher tier when the request actually needs it. Do not favour a vendor by name.",
          criteria,
        },
      },
    };
    const requestBody = JSON.stringify(payload);

    logJevRequest({
      prompt: payload.state,
      modelCriteria: criteria,

      fullPayload: payload,
      enrichCriteria: !!options.enrichCriteria,
    }, models.length);

    if (options.debug) {
      const sample = Object.entries(criteria).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" | ");
      options.info?.(`[JEV-DEBUG] ${Object.keys(criteria).length} Modelle, Beispiele: ${sample}`);
      options.info?.(`[JEV-DEBUG] Full payload JSON:\n${requestBody}`);
    }

    const response = await (options.fetch || fetch)(JEV_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
      signal: controller.signal,
    });
    if (!response.ok) {
      updateLastJevRequest({ error: `HTTP ${response.status}` });
      logUsage({ status: "error", httpStatus: response.status, promptTokens: estimateTextTokens(requestBody), fallbackReason: `HTTP ${response.status}` });
      return fail(`Jev API HTTP ${response.status}`);
    }

    // response.text() may be unavailable on lightweight test doubles that only
    // implement .json(); fall back to re-stringifying the parsed body for those.
    const rawText = typeof response.text === "function" ? await response.text() : JSON.stringify(await response.json());
    const data = safeParseJson(rawText);
    const selected = pickAnswer(data, MODEL_QUESTION_ID);
    // Jev's SystemOne API never returns a usage field (extractJevTokens is a real-usage
    // fast path, currently always 0); fall back to estimating from actual payload sizes
    // so the dashboard shows non-zero, roughly-accurate in/out token counts.
    const realTokens = extractJevTokens(data);
    logUsage({
      status: "success",
      httpStatus: response.status,
      promptTokens: realTokens || estimateTextTokens(requestBody),
      completionTokens: realTokens ? 0 : estimateTextTokens(rawText),
      choice: typeof selected === "string" ? selected : undefined,
    });
    if (typeof selected !== "string" || !models.includes(selected)) {
      updateLastJevRequest({ rawSelected: selected, invalid: true });
      options.info?.(`Jev wählte ungültig '${selected}'`);
      return fail(`Ungültige Jev-Auswahl '${selected}'`);
    }

    updateLastJevRequest({ selectedModel: selected });
    setSessionModel(sessionKey(body), selected);
    setCachedJevDecision(sessKey, estimatedTokens, selected, "", options.cacheJevTtlMs);
    options.info?.(`Jev wählte '${selected}'${session.previousModel === selected ? " (sticky)" : ""}`);
    return selected;
  } catch (error) {
    const reason = error?.name === "AbortError" ? "timeout" : `network: ${error?.message || error}`;
    updateLastJevRequest({ error: reason });
    logUsage({ status: "error", fallbackReason: reason });
    return fail(error?.name === "AbortError" ? "Jev API Timeout" : `Jev API Fehler: ${error?.message || error}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
