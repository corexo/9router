import { extractTokens as extractJevTokens, recordJevUsage } from "@/lib/jev/client.js";
const JEV_API_URL = process.env.JEV_API_URL || "https://jev-ai.pro/api/v1/systemone";
const QUESTION_ID = "target_model";
const JEV_MODEL = "jev-1.13.0";
const DEFAULT_TIMEOUT_MS = 4500;
const MAX_PROMPT_LENGTH = 3000;

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
function buildCriteria(models) {
  return Object.fromEntries(models.map((model) => [model, `Route to ${model}`]));
}

// Response shape is not contractually fixed; accept the documented nestings.
function pickAnswer(data) {
  const node = data?.results?.[QUESTION_ID] ?? data?.answers?.[QUESTION_ID] ?? data?.[QUESTION_ID];
  const value = typeof node === "object" && node !== null
    ? (node.choice ?? node.selected ?? node.answer ?? node.value)
    : node;
  return typeof value === "string" ? value.trim() : undefined;
}

/**
 * options: { apiKey, defaultModel, timeoutMs } — UI settings win, env is the fallback.
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
          [QUESTION_ID]: {
            type: "choice",
            instructions: "Which model should handle this coding-agent request best regarding quality, specialization and latency?",
            criteria: buildCriteria(models),
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
    const selected = pickAnswer(data);
    logUsage({ status: "success", httpStatus: response.status, tokens: extractJevTokens(data), choice: typeof selected === "string" ? selected : undefined });
    options.info?.(`Jev wählte '${selected}'`);
    if (typeof selected !== "string" || !models.includes(selected)) {
      return fail(`Ungültige Jev-Auswahl '${selected}'`);
    }
    return selected;
  } catch (error) {
    logUsage({ status: "error", fallbackReason: error?.name === "AbortError" ? "timeout" : `network: ${error?.message || error}` });
    return fail(error?.name === "AbortError" ? "Jev API Timeout" : `Jev API Fehler: ${error?.message || error}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
