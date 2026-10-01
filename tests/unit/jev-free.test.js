import { describe, it, expect, beforeEach } from "vitest";
import { JEV_FREE_MODEL_ALIASES, JEV_MODEL_ALIASES, JEV1M_MODEL_ALIASES } from "../../src/sse/services/jevRouter.js";

describe("JEV_FREE_MODEL_ALIASES", () => {
  it("contains jev-free and nineRouter/jev-free", () => {
    expect(JEV_FREE_MODEL_ALIASES.has("jev-free")).toBe(true);
    expect(JEV_FREE_MODEL_ALIASES.has("nineRouter/jev-free")).toBe(true);
  });

  it("does not overlap with paid aliases", () => {
    for (const alias of JEV_FREE_MODEL_ALIASES) {
      expect(JEV_MODEL_ALIASES.has(alias)).toBe(false);
      expect(JEV1M_MODEL_ALIASES.has(alias)).toBe(false);
    }
  });
});

describe("jev-free pool filtering logic", () => {
  const PAID_PROVIDERS = new Set(["claude", "anthropic", "codex", "chatgpt", "openai", "glm", "glm-cn", "zai"]);

  function providerFromModelId(id) {
    return id.split("/")[0];
  }

  const activeModels = [
    { id: "glm/glm-4-flash", provider: "glm" },
    { id: "codex/gpt-4o", provider: "codex" },
    { id: "groq/llama-3.1-8b-instant", provider: "groq" },
    { id: "cf/meta/llama-3-8b-instruct", provider: "cloudflare-ai" },
    { id: "ollama/llama3", provider: "ollama" },
  ];

  it("auto-free pool excludes paid providers when jevFreePoolModels is undefined", () => {
    const activeIds = new Set(activeModels.map((m) => m.id));
    const freePool = [...activeIds].filter((id) => !PAID_PROVIDERS.has(providerFromModelId(id)));
    expect(freePool).toContain("groq/llama-3.1-8b-instant");
    expect(freePool).toContain("cf/meta/llama-3-8b-instruct");
    expect(freePool).toContain("ollama/llama3");
    expect(freePool).not.toContain("glm/glm-4-flash");
    expect(freePool).not.toContain("codex/gpt-4o");
  });

  it("explicit jevFreePoolModels is used verbatim when set", () => {
    const jevFreePoolModels = ["groq/llama-3.1-8b-instant"];
    const freePool = jevFreePoolModels.filter(
      (id) => !JEV_FREE_MODEL_ALIASES.has(id) && typeof id === "string" && id.includes("/")
    );
    expect(freePool).toEqual(["groq/llama-3.1-8b-instant"]);
  });

  it("jev-free aliases are never included in the free pool itself", () => {
    const pool = ["jev-free", "nineRouter/jev-free", "groq/llama-3.1-8b-instant"];
    const filtered = pool.filter((id) => !JEV_FREE_MODEL_ALIASES.has(id) && id.includes("/"));
    expect(filtered).not.toContain("jev-free");
    expect(filtered).not.toContain("nineRouter/jev-free");
    expect(filtered).toContain("groq/llama-3.1-8b-instant");
  });
});
