const JEV_API_URL = process.env.JEV_API_URL || "https://jev-ai.pro/api/v1/systemone";
const JEV_MODEL = "jev-1.13.0";

const ERROR_ADJUDICATION_TIMEOUT_MS = 1200;
const ERROR_ADJUDICATION_MAX_CHOICES = 8;

/**
 * Bounded provider-error adjudication. Sends no prompt or credentials; deterministic
 * quota detection remains authoritative and this is only for ambiguous failures.
 */
export async function adjudicateProviderError({ provider, model, status, error, retryAfterMs, eligibleModels = [], apiKey, timeoutMs = ERROR_ADJUDICATION_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const text = typeof error === "string" ? error : JSON.stringify(error || "");
  const lower = text.toLowerCase();
  const obviousGeminiQuota = provider === "gemini-cli" && status === 429
    && /resource_exhausted|generate_content_free_tier_input_token_count/.test(lower);
  if (obviousGeminiQuota) return { action: "next_account", reason: "deterministic_gemini_free_tier_quota", retryAfterMs };
  if (!apiKey) return null;

  const candidates = [...new Set(eligibleModels)].filter((candidate) => candidate !== model).slice(0, ERROR_ADJUDICATION_MAX_CHOICES);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(1, timeoutMs), ERROR_ADJUDICATION_TIMEOUT_MS));
  try {
    const response = await fetchImpl(JEV_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        state: JSON.stringify({ provider, model, status, retryAfterMs: retryAfterMs || null, error: text.slice(0, 600), eligibleModels: candidates }),
        model: JEV_MODEL,
        questions: { action: { type: "choice", instructions: "Choose one safe failover action. Never retry an exhausted quota. Return JSON only.", criteria: {
          next_account: "Switch account; account-scoped or ambiguous transient failure",
          next_model: "Switch model; current model-specific failure",
          retry_after: "Retry only after the stated delay; transient provider failure",
          return_error: "Do not retry; request-scoped or unsupported error"
        } } }
      }),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = await response.json();
    const raw = data?.answers?.action ?? data?.results?.action ?? data?.action;
    const action = typeof raw === "string" ? raw : raw?.choice ?? raw?.selected;
    if (!["next_account", "next_model", "retry_after", "return_error"].includes(action)) return null;
    // Model changes require an explicit configured candidate, never a fabricated ID.
    const chosenModel = typeof raw === "object" ? raw?.model : undefined;
    if (action === "next_model" && !candidates.includes(chosenModel)) return null;
    if (action === "retry_after" && !(retryAfterMs > 0)) return null;
    return { action, model: action === "next_model" ? chosenModel : undefined, retryAfterMs };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
