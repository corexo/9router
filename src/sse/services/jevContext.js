// Reserve output even when the client leaves generation limits unspecified.
export function fitsJevContext(capabilities, inputTokens, body = {}) {
  const window = Number(capabilities?.contextWindow);
  const output = Number(body.max_completion_tokens ?? body.max_tokens ?? capabilities?.maxOutput ?? 8192);
  return Number.isFinite(window) && window > 0
    && Number.isFinite(inputTokens) && inputTokens >= 0
    && Number.isFinite(output) && output > 0
    && window >= inputTokens + output + 1000;
}
