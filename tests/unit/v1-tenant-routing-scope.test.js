import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const auth = readFileSync(resolve(root, "src/sse/services/auth.js"), "utf8");
const chat = readFileSync(resolve(root, "src/sse/handlers/chat.js"), "utf8");
const models = readFileSync(resolve(root, "src/app/api/v1/models/route.js"), "utf8");
const modelResolver = readFileSync(resolve(root, "src/sse/services/model.js"), "utf8");
const requestHandlers = ["chat", "embeddings", "search", "fetch", "imageGeneration", "stt", "tts", "videoGeneration"]
  .map((name) => readFileSync(resolve(root, `src/sse/handlers/${name}.js`), "utf8"));

describe("/v1 tenant routing boundary", () => {
  it("filters provider credentials using the API-key owner, denies unowned keys in tenant mode", () => {
    expect(auth).toContain('...(options.tenantScoped ? { ownerUsername: options.ownerUsername || "__unowned__" } : {})');
    expect(chat).toContain('tenantScoped && !ownerUsername');
    expect(chat).toContain('tenantScoped: true');
  });

  it("applies tenant scope to each API-key routed provider handler", () => {
    for (const handler of requestHandlers) {
      expect(handler).toContain("getTenantRequestContext(request)");
      expect(handler).toContain("tenantScoped");
    }
  });

  it("scopes /v1/models, custom provider nodes and combos to the caller owner", () => {
    expect(models).toContain("getApiKeyDetailsForRequest(request)");
    expect(models).toContain("buildModelsList([LLM_KIND], { skipDynamicFetch, includeDiscovered, ownerUsername })");
    expect(modelResolver).toContain('getProviderNodes({ type: "openai-compatible", ...(ownerUsername ? { ownerUsername } : {}) })');
    expect(modelResolver).toContain("getComboByName(modelStr, ownerUsername)");
  });
});
