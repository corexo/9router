// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getProviderConnectionById } from "@/lib/localDb";
import {
  consumeCodexRateLimitResetCredit,
  getCodexRateLimitResetCredits,
  getUsageForProvider,
  clearClaudeUsageCache,
} from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { clearConnectionLocks } from "@/sse/services/auth.js";

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];

function isAuthExpiredResult(result) {
  const values = [result?.message, result?.code, result?.raw?.detail, result?.raw?.error]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => AUTH_EXPIRED_PATTERNS.some((pattern) => value.includes(pattern)));
}

function isAuthExpiredError(error) {
  return isAuthExpiredResult({ message: error?.message });
}

const SUPPORTED_RESET_PROVIDERS = ["codex", "claude", "glm", "glm-cn"];

async function getConnectionAndProxy(connectionId) {
  const connection = await getProviderConnectionById(connectionId);
  if (!connection) {
    return { response: Response.json({ error: "Connection not found" }, { status: 404 }) };
  }

  if (!SUPPORTED_RESET_PROVIDERS.includes(connection.provider)) {
    return {
      response: Response.json(
        { error: `Reset credits/quota reset not supported for provider '${connection.provider}'.` },
        { status: 400 }
      ),
    };
  }

  const isOAuth = connection.authType === "oauth";
  const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
  const proxyOptions = {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  };

  return { connection, isOAuth, proxyOptions };
}

async function refreshOAuthConnection(connection, proxyOptions) {
  try {
    const result = await refreshAndUpdateCredentials(connection, false, proxyOptions);
    return { connection: result.connection };
  } catch (refreshError) {
    console.error("[Reset Credits API] Credential refresh failed:", refreshError);
    return { response: Response.json({ error: `Credential refresh failed: ${refreshError.message}` }, { status: 401 }) };
  }
}

export async function GET(_request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    const resolved = await getConnectionAndProxy(connectionId);
    if (resolved.response) return resolved.response;
    ({ connection } = resolved);
    const { isOAuth, proxyOptions } = resolved;

    if (isOAuth && connection.provider === "codex") {
      const refreshed = await refreshOAuthConnection(connection, proxyOptions);
      if (refreshed.response) return refreshed.response;
      connection = refreshed.connection;
    }

    if (connection.provider === "codex") {
      let result;
      try {
        result = await getCodexRateLimitResetCredits(connection.accessToken, proxyOptions, connection.providerSpecificData);
      } catch (fetchError) {
        if (!isOAuth || !connection.refreshToken || !isAuthExpiredError(fetchError)) throw fetchError;
        const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
        connection = retryResult.connection;
        result = await getCodexRateLimitResetCredits(connection.accessToken, proxyOptions, connection.providerSpecificData);
      }
      return Response.json(result);
    }

    // For Claude and GLM: fetch usage to get availableResetCredits
    const usage = await getUsageForProvider(connection, proxyOptions, { force: false });
    const availableCount = Number(usage?.resetCredits?.availableCount) || 0;
    return Response.json({
      provider: connection.provider,
      availableCount,
      credits: [],
    });
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Reset Credits] ${provider}: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(_request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    const resolved = await getConnectionAndProxy(connectionId);
    if (resolved.response) return resolved.response;
    ({ connection } = resolved);
    const { isOAuth, proxyOptions } = resolved;

    if (isOAuth && connection.provider === "codex") {
      const refreshed = await refreshOAuthConnection(connection, proxyOptions);
      if (refreshed.response) return refreshed.response;
      connection = refreshed.connection;
    }

    // 1. CODEX reset
    if (connection.provider === "codex") {
      const redeemRequestId = crypto.randomUUID();
      let consumeResult = await consumeCodexRateLimitResetCredit(connection.accessToken, redeemRequestId, proxyOptions);

      if (isOAuth && isAuthExpiredResult(consumeResult) && connection.refreshToken) {
        try {
          const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
          connection = retryResult.connection;
          consumeResult = await consumeCodexRateLimitResetCredit(connection.accessToken, redeemRequestId, proxyOptions);
        } catch (retryError) {
          console.warn(`[Reset Credits] Codex force refresh failed: ${retryError.message}`);
        }
      }

      if (consumeResult.ok) {
        await clearConnectionLocks(connectionId);
        return Response.json({
          code: consumeResult.code,
          reset: true,
          windows_reset: consumeResult.windowsReset,
          redeemRequestId,
          credit: consumeResult.raw?.credit || null,
          provider: "codex",
        });
      }

      if (consumeResult.noCredit) {
        return Response.json(
          {
            code: "no_credit",
            reset: false,
            windows_reset: consumeResult.windowsReset,
            message: "No Codex reset credits available.",
            provider: "codex",
          },
          { status: 409 }
        );
      }

      return Response.json(
        {
          code: consumeResult.code || "unknown_response",
          reset: false,
          windows_reset: consumeResult.windowsReset,
          message: consumeResult.message || "Codex reset credit consume returned an unexpected response.",
          provider: "codex",
        },
        { status: consumeResult.status >= 400 && consumeResult.status < 500 ? consumeResult.status : 502 }
      );
    }

    // 2. CLAUDE reset
    if (connection.provider === "claude") {
      clearClaudeUsageCache(connection.accessToken);
      await clearConnectionLocks(connectionId);
      // Force refresh usage
      await getUsageForProvider(connection, proxyOptions, { force: true }).catch(() => null);

      return Response.json({
        code: "reset",
        reset: true,
        windows_reset: 1,
        message: "Claude limit locks and cache reset successfully on PiRouter.",
        provider: "claude",
      });
    }

    // 3. GLM reset
    if (connection.provider === "glm" || connection.provider === "glm-cn") {
      await clearConnectionLocks(connectionId);
      // Force refresh usage
      await getUsageForProvider(connection, proxyOptions, { force: true }).catch(() => null);

      return Response.json({
        code: "reset",
        reset: true,
        windows_reset: 1,
        message: "GLM quota locks and cache reset successfully on PiRouter.",
        provider: connection.provider,
      });
    }

    return Response.json({ error: `Provider ${connection.provider} not supported` }, { status: 400 });
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Reset Credits] ${provider}: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
