import * as auth from "./auth.js";
import * as db from "@/lib/localDb";

export async function getTenantRequestContext(request) {
  const apiKey = typeof auth.extractApiKey === "function" ? auth.extractApiKey(request) : null;
  const apiKeyDetails = apiKey && typeof auth.getApiKeyDetailsForRequest === "function"
    ? await auth.getApiKeyDetailsForRequest(request)
    : null;
  const tenantScoped = typeof db.hasUsers === "function" ? await db.hasUsers() : false;
  return {
    apiKey,
    apiKeyDetails,
    ownerUsername: apiKeyDetails?.ownerUsername || null,
    tenantScoped,
  };
}
