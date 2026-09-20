import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import { saveRequestUsage } from "@/lib/db/repos/usageRepo.js";

export const JEV_API_URL = process.env.JEV_API_URL || "https://jev-ai.pro/api/v1/systemone";
export const JEV_MODEL = "jev-1.13.0";
const JEV_PROVIDER = "jev";

export async function getJevApiKey(settings) {
  const stored = settings ? settings.jevApiKey : (await getSettings()).jevApiKey;
  return stored || process.env.TYPESAFE_API_KEY || process.env.JEV_AI_API_KEY || "";
}

// Jev bills credits as tokens / 1_000_000 (dashboard: 445 tokens -> 0.000445 credits).
export function creditsFromTokens(tokens) {
  return typeof tokens === "number" && tokens > 0 ? tokens / 1_000_000 : 0;
}

export function extractTokens(data) {
  const usage = data?.usage || data?.meta?.usage || {};
  const total = usage.total_tokens ?? usage.tokens ?? data?.tokens;
  return typeof total === "number" ? total : 0;
}

// Jev's SystemOne API never returns a usage/tokens field, so extractTokens always
// resolves to 0 in production. Approximate prompt/completion size from the actual
// request/response payloads instead — same rough chars-per-token heuristic used by
// estimateQoderPromptTokens (open-sse/shared/qoder/contextTier.js), good enough for
// dashboard/cost display purposes, not billing-precise.
export function estimateTextTokens(value) {
  if (!value) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(text.length / 4);
}

/**
 * Fire-and-forget usage record. Never throws, never blocks the caller.
 * saveRequestUsage recalculates entry.cost from pricing, so credits ride in meta.
 */
export function recordJevUsage(entry) {
  const promptTokens = entry.promptTokens ?? entry.tokens ?? 0;
  const completionTokens = entry.completionTokens ?? 0;
  const totalTokens = promptTokens + completionTokens;
  const credits = creditsFromTokens(totalTokens);
  Promise.resolve()
    .then(() =>
      saveRequestUsage({
        provider: JEV_PROVIDER,
        model: JEV_MODEL,
        endpoint: entry.endpoint,
        status: entry.status,
        cost: credits,
        tokens: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens },
        meta: {
          caller: entry.caller,
          questionType: entry.questionType,
          choice: entry.choice,
          latencyMs: entry.latencyMs,
          httpStatus: entry.httpStatus,
          fallbackReason: entry.fallbackReason,
          tokens: totalTokens,
          promptTokens,
          completionTokens,
          credits,
        },
      })
    )
    .catch(() => {});
}
