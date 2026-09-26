/**
 * Codex live model catalog.
 *
 * Fetches the account-specific model list from the ChatGPT backend
 * (/backend-api/codex/models) with refresh-on-401, and merges the result
 * with the static codex registry for display-only visibility.
 *
 * Credentials never leave the process: tokens are used only in request
 * headers and never appear in return values, warnings, or logs.
 */

import { refreshCodexToken } from "./tokenRefresh.js";

// The /codex/models endpoint gates each entry by minimal_client_version against this
// value, and codex CLI's own manifest (openai/codex codex-rs/models-manager/models.json)
// already requires newer versions for its newest models, so a stale client_version here
// comes back 200 with those entries quietly missing instead of erroring. Keep in sync
// with CODEX_CLI_VERSION in open-sse/providers/registry/codex.js (0.157.1).
const CODEX_CLIENT_VERSION = "0.157.1";
export const CODEX_MODELS_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLIENT_VERSION}`;

function parseOpenAIStyleModels(data) {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
}

// Append the `-review` quota-family derivative for every chat model.
// Image and embedding models are kept as-is (no review derivative).
export function appendCodexReviewModels(models) {
  return models.flatMap((model) => {
    const id = model?.id || model?.slug || model?.model || model?.name;
    if (!id) return [];
    const name = model?.display_name || model?.displayName || model?.name || id;
    const normalized = { ...model, id, name };
    const isChatModel = (model?.type || "llm") !== "image" && !id.toLowerCase().includes("embed");
    if (!isChatModel || id.endsWith("-review")) return [normalized];
    return [
      normalized,
      {
        ...normalized,
        id: `${id}-review`,
        name: `${name} Review`,
        upstreamModelId: id,
        quotaFamily: "review",
      },
    ];
  });
}

export function parseCodexModels(data) {
  return appendCodexReviewModels(parseOpenAIStyleModels(data));
}

/**
 * Resolve the live codex model catalog for one account.
 *
 * @param {object} credentials - `{ accessToken, refreshToken }`.
 * @param {object} [options]
 * @param {function} [options.onCredentialsRefreshed] - Persist refreshed credentials
 *   (`{ accessToken, refreshToken, expiresIn }`) after a 401-triggered refresh.
 * @param {object} [options.log] - Console-like logger.
 * @param {function} [options.fetchFn] - Injectable fetch (tests).
 * @returns {Promise<{models: Array<object>, warning?: string}>}
 *   Parsed live models; on failure `{ models: [], warning }` — never throws.
 */
export async function resolveCodexLiveModels(credentials = {}, options = {}) {
  const { accessToken, refreshToken } = credentials;
  const { onCredentialsRefreshed, log, fetchFn = fetch } = options;
  if (!accessToken) {
    return { models: [], warning: "No access token available for Codex models." };
  }

  const doFetch = (token) => fetchFn(CODEX_MODELS_URL, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
      "originator": "codex_cli_rs"
    }
  });

  try {
    let response = await doFetch(accessToken);

    if (!response.ok && (response.status === 401 || response.status === 403) && refreshToken) {
      const refreshed = await refreshCodexToken(refreshToken);
      if (refreshed?.accessToken) {
        if (typeof onCredentialsRefreshed === "function") {
          try {
            await onCredentialsRefreshed({
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken || refreshToken,
              expiresIn: refreshed.expiresIn,
            });
          } catch (error) {
            log?.log?.(`Codex models: onCredentialsRefreshed failed: ${error?.message || error}`);
          }
        }
        response = await doFetch(refreshed.accessToken);
      }
    }

    if (response.ok) {
      const data = await response.json();
      return { models: parseCodexModels(data) };
    }

    const warning = `Failed to fetch Codex models: ${response.status}`;
    log?.log?.(warning);
    return { models: [], warning };
  } catch (error) {
    const warning = `Failed to fetch Codex models: ${error.message}`;
    log?.log?.(warning);
    return { models: [], warning };
  }
}

/**
 * Merge live-discovered codex models with the static registry for
 * display-only visibility. Never mutates either input.
 *
 * Tags:
 * - present in both  -> `{ source: "verified", verified: true }` (static metadata wins)
 * - discovered-only  -> `{ source: "discovered", verified: false }`
 * - static-only      -> `{ source: "static", verified: true }`
 *
 * @param {Array<object>} liveModels - Discovered models from resolveCodexLiveModels.
 * @param {Array<object>} staticModels - Static registry models (open-sse/providers/registry/codex.js).
 * @returns {Array<object>} Merged list: static order first, discovered-only appended.
 */
export function mergeCodexModelsWithRegistry(liveModels = [], staticModels = []) {
  const liveById = new Map();
  for (const model of liveModels) {
    if (model?.id && !liveById.has(model.id)) liveById.set(model.id, model);
  }

  const merged = staticModels.map((model) => {
    if (!liveById.has(model.id)) return { ...model, source: "static", verified: true };
    liveById.delete(model.id);
    return { ...model, source: "verified", verified: true };
  });

  for (const model of liveById.values()) {
    merged.push({ ...model, source: "discovered", verified: false });
  }

  return merged;
}
