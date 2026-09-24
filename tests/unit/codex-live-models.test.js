import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshCodexToken: vi.fn(),
}));

import { refreshCodexToken } from "../../open-sse/services/tokenRefresh.js";
import {
  CODEX_MODELS_URL,
  mergeCodexModelsWithRegistry,
  parseCodexModels,
  resolveCodexLiveModels,
} from "../../open-sse/services/codexModels.js";
import codexRegistry from "../../open-sse/providers/registry/codex.js";

const originalFetch = global.fetch;

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("resolveCodexLiveModels", () => {
  beforeEach(() => {
    vi.mocked(refreshCodexToken).mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("calls the codex models endpoint with bearer token and codex originator", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: [{ slug: "gpt-5.5" }] }));
    const result = await resolveCodexLiveModels(
      { accessToken: "tok-abc", refreshToken: "rt-abc" },
      { fetchFn },
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(CODEX_MODELS_URL);
    expect(init.headers.Authorization).toBe("Bearer tok-abc");
    expect(init.headers.originator).toBe("codex_cli_rs");
    expect(result.models.map((m) => m.id)).toContain("gpt-5.5");
    // Token never leaks into the result
    expect(JSON.stringify(result)).not.toContain("tok-abc");
    expect(JSON.stringify(result)).not.toContain("rt-abc");
  });

  it("refreshes once on 401, persists via onCredentialsRefreshed, and retries", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ data: [{ slug: "gpt-5.5" }] }));
    vi.mocked(refreshCodexToken).mockResolvedValue({ accessToken: "tok-new", refreshToken: "rt-new", expiresIn: 3600 });
    const onCredentialsRefreshed = vi.fn();

    const result = await resolveCodexLiveModels(
      { accessToken: "tok-old", refreshToken: "rt-old" },
      { fetchFn, onCredentialsRefreshed },
    );

    expect(refreshCodexToken).toHaveBeenCalledWith("rt-old");
    expect(onCredentialsRefreshed).toHaveBeenCalledWith({
      accessToken: "tok-new",
      refreshToken: "rt-new",
      expiresIn: 3600,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe("Bearer tok-new");
    expect(result.models.map((m) => m.id)).toContain("gpt-5.5");
  });

  it("keeps the original refresh token when the refresh response omits one", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 403))
      .mockResolvedValueOnce(jsonResponse({ data: [{ slug: "gpt-5.5" }] }));
    vi.mocked(refreshCodexToken).mockResolvedValue({ accessToken: "tok-new" });
    const onCredentialsRefreshed = vi.fn();

    await resolveCodexLiveModels(
      { accessToken: "tok-old", refreshToken: "rt-old" },
      { fetchFn, onCredentialsRefreshed },
    );

    expect(onCredentialsRefreshed).toHaveBeenCalledWith({
      accessToken: "tok-new",
      refreshToken: "rt-old",
      expiresIn: undefined,
    });
  });

  it("returns empty models with a warning on 401 without refreshToken — no throw", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 401));

    const result = await resolveCodexLiveModels({ accessToken: "tok-old" }, { fetchFn });

    expect(result.models).toEqual([]);
    expect(result.warning).toContain("401");
    expect(refreshCodexToken).not.toHaveBeenCalled();
  });

  it("returns empty models with a warning on network errors", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("boom"));

    const result = await resolveCodexLiveModels({ accessToken: "tok-old" }, { fetchFn });

    expect(result.models).toEqual([]);
    expect(result.warning).toContain("boom");
  });

  it("parses { data: [...] }, bare-array and { models: [...] } response shapes", () => {
    const ids = (models) => models.map((m) => m.id);
    expect(ids(parseCodexModels({ data: [{ slug: "gpt-5.5" }] }))).toContain("gpt-5.5");
    expect(ids(parseCodexModels([{ slug: "gpt-5.4" }]))).toContain("gpt-5.4");
    expect(ids(parseCodexModels({ models: [{ slug: "gpt-6-astra" }] }))).toContain("gpt-6-astra");
  });

  it("derives -review models for chat models but not for image/embedding models", () => {
    const models = parseCodexModels({
      data: [
        { slug: "gpt-5.5" },
        { slug: "gpt-image-2.5", type: "image" },
        { slug: "text-embed-x" },
        { slug: "already-review", slug_display: "x" },
      ],
    });
    const ids = models.map((m) => m.id);

    expect(ids).toContain("gpt-5.5");
    expect(ids).toContain("gpt-5.5-review");
    expect(models.find((m) => m.id === "gpt-5.5-review").quotaFamily).toBe("review");
    expect(ids).not.toContain("gpt-image-2.5-review");
    expect(ids).not.toContain("text-embed-x-review");
    expect(ids.filter((id) => id === "already-review")).toHaveLength(1);
  });
});

describe("mergeCodexModelsWithRegistry", () => {
  const staticModels = [
    { id: "gpt-5.5", name: "GPT 5.5", capabilities: ["tools"] },
    { id: "gpt-5.5-review", name: "GPT 5.5 Review", upstreamModelId: "gpt-5.5" },
  ];

  it("tags intersection verified, discovered-only unverified, static-only static", () => {
    const live = [
      { id: "gpt-5.5", name: "GPT 5.5 (live)" },
      { id: "gpt-7-new", name: "GPT 7 New" },
    ];

    const merged = mergeCodexModelsWithRegistry(live, staticModels);

    expect(merged).toHaveLength(3);
    const byId = Object.fromEntries(merged.map((m) => [m.id, m]));
    expect(byId["gpt-5.5"].source).toBe("verified");
    expect(byId["gpt-5.5"].verified).toBe(true);
    // Static metadata wins on conflict
    expect(byId["gpt-5.5"].name).toBe("GPT 5.5");
    expect(byId["gpt-5.5"].capabilities).toEqual(["tools"]);
    expect(byId["gpt-5.5-review"].source).toBe("static");
    expect(byId["gpt-7-new"].source).toBe("discovered");
    expect(byId["gpt-7-new"].verified).toBe(false);
  });

  it("dedupes by id and never emits ids outside static ∪ discovered", () => {
    const live = [
      { id: "gpt-5.5" },
      { id: "gpt-5.5" },
      { id: "gpt-7-new" },
    ];

    const merged = mergeCodexModelsWithRegistry(live, staticModels);

    expect(merged.map((m) => m.id).sort()).toEqual(["gpt-5.5", "gpt-5.5-review", "gpt-7-new"].sort());
  });

  it("does not mutate the static registry", () => {
    const registryBefore = JSON.stringify(codexRegistry.models);
    const live = [{ id: "gpt-7-new" }, { id: "gpt-5.5" }];

    mergeCodexModelsWithRegistry(live, codexRegistry.models);

    expect(JSON.stringify(codexRegistry.models)).toBe(registryBefore);
  });
});
