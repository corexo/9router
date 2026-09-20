import { extractTokens as extractJevTokens, recordJevUsage } from "@/lib/jev/client.js";
import { logJevRequest } from "@/lib/jev/requestLog.js";
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
async function buildEnrichedCriteria(models, options = {}) {
  if (!options.getPricingForModel || !options.getModelHealth) return buildCriteria(models);

  const result = {};
  const health = await options.getModelHealth?.().catch(() => ({}));
  const connections = await options.getProviderConnections?.().catch(() => []);
  const stats = await options.getUsageStats?.().catch(() => ({ byModel: {} }));

  for (const model of models) {
    const parts = model.split("/");
    const provider = parts[0];
    const bareModel = parts[1] || model;

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
        ? `$${(pricing.input / 1000000).toFixed(4)} in/$${(pricing.output / 1000000).toFixed(4)} out`
        : "Cost: unknown";

      const connForProvider = connections.find((c) => c.provider === provider || c.providerId === provider);
      let accountStr = "Account: OK";
      if (connForProvider?.rateLimitedUntil) {
        const untilMs = new Date(connForProvider.rateLimitedUntil).getTime();
        const nowMs = Date.now();
        if (untilMs > nowMs) {
          const secsLeft = Math.ceil((untilMs - nowMs) / 1000);
          accountStr = `Account: Rate-limited (${secsLeft}s)`;
        }
      }

      const statsKey = `${bareModel} (${provider})`;
      const modelStats = stats.byModel?.[statsKey];
      let successStr = "Success: N/A";
      if (modelStats?.requests) {
        const successRate = Math.round((modelStats.success || 0) / (modelStats.requests || 1) * 100);
        successStr = `Success: ${successRate}%`;
      }

      desc = `${model} | Cost: ${costStr} | ${successStr} | ${accountStr}`;
    }

    result[model] = desc;
  }

  return result;
}

// Response shape is not contractually fixed; accept the documented nestings.
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
  if (typeof getLevels !== "function") return "";

  const provider = options.providerFromModelId?.(chosenModel) ?? chosenModel.split("/")[0];
  const bareModel = chosenModel.includes("/") ? chosenModel.slice(chosenModel.indexOf("/") + 1) : chosenModel;
  const supported = getLevels(provider, bareModel);
  if (!Array.isArray(supported) || supported.length === 0) return ""; // model has no reasoning capability at all

  if (supported.includes(level)) return `(${level})`;
  if (level === "none") return ""; // model can't disable thinking anyway — leave provider default

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
    return fallback;
  };

  if (models.length === 0) return fail("Keine verfügbaren Modelle");
  if (!apiKey) return fail("Jev API Key fehlt");

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
    tokens: result.tokens || 0,
    choice: result.choice,
    fallbackReason: result.fallbackReason,
  });
  try {
    const criteria = options.enrichCriteria
      ? await buildEnrichedCriteria(models, options)
      : buildCriteria(models);

    logJevRequest(criteria, models.length);

    if (options.debug) {
      const sample = Object.entries(criteria).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' | ');
      options.info?.(`[JEV-DEBUG] ${Object.keys(criteria).length} Modelle, Beispiele: ${sample}`);
    }

    const response = await (options.fetch || fetch)(JEV_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state: extractJevPrompt(body),
        model: JEV_MODEL,
        questions: {
          [MODEL_QUESTION_ID]: {
            type: "choice",
            instructions: "Which model should handle this coding-agent request best regarding quality, specialization and latency?",
            criteria,
          },
          [THINKING_QUESTION_ID]: {
            type: "choice",
            instructions: "How much reasoning effort does this specific request need? Pick based on task difficulty, not on the chosen model's capabilities — the router clamps this to what the chosen model actually supports.",
            criteria: THINKING_CRITERIA,
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      logUsage({ status: "error", httpStatus: response.status, fallbackReason: `HTTP ${response.status}` });
      return fail(`Jev API HTTP ${response.status}`);
    }

    const data = await response.json();
    const selected = pickAnswer(data, MODEL_QUESTION_ID);
    const rawThinking = pickAnswer(data, THINKING_QUESTION_ID);
    logUsage({ status: "success", httpStatus: response.status, tokens: extractJevTokens(data), choice: typeof selected === "string" ? selected : undefined });
    if (typeof selected !== "string" || !models.includes(selected)) {
      options.info?.(`Jev wählte ungültig '${selected}'`);
      return fail(`Ungültige Jev-Auswahl '${selected}'`);
    }

    // Combo names never contain "/"; a thinking suffix only makes sense on a concrete
    // provider/model target, not on a combo (which resolves to many different models).
    const suffix = selected.includes("/") ? resolveThinkingSuffix(rawThinking, selected, options) : "";
    options.info?.(`Jev wählte '${selected}'${suffix ? ` Thinking='${suffix.slice(1, -1)}'` : ""}${rawThinking && !suffix ? ` (angefragt '${rawThinking}', nicht anwendbar)` : ""}`);
    return `${selected}${suffix}`;
  } catch (error) {
    logUsage({ status: "error", fallbackReason: error?.name === "AbortError" ? "timeout" : `network: ${error?.message || error}` });
    return fail(error?.name === "AbortError" ? "Jev API Timeout" : `Jev API Fehler: ${error?.message || error}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
