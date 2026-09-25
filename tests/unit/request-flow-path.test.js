import { describe, expect, it } from "vitest";
import { buildPath, pathColor } from "../../src/app/(dashboard)/dashboard/flow/path.js";

describe("request flow buildPath", () => {
  it("fehler request endet im error-sink", () => {
    expect(buildPath({ status: "error" })).toEqual(["http", "gateway", "auth", "engine", "error"]);
  });

  it("cache-hit + stream laeuft ueber cache und sse", () => {
    expect(buildPath({ status: "success", cached: true, stream: true }))
      .toEqual(["http", "gateway", "auth", "engine", "cache", "ai", "stream"]);
  });

  it("cache-miss json-response ohne cache-knoten", () => {
    expect(buildPath({ status: "success", cached: false, stream: false }))
      .toEqual(["http", "gateway", "auth", "engine", "ai", "ok"]);
  });

  it("stream ohne cache laeuft direkt zu sse", () => {
    expect(buildPath({ status: "success", cached: false, stream: true }))
      .toEqual(["http", "gateway", "auth", "engine", "ai", "stream"]);
  });

  it("fehler dominiert unabhaengig von stream/cached", () => {
    expect(buildPath({ status: "error", cached: true, stream: true }))
      .toEqual(["http", "gateway", "auth", "engine", "error"]);
  });
});

describe("request flow pathColor", () => {
  it("fehler rot, stream amber, cache gruen, sonst blau", () => {
    expect(pathColor({ status: "error" })).toBe("#fb7185");
    expect(pathColor({ status: "success", stream: true })).toBe("#fbbf24");
    expect(pathColor({ status: "success", cached: true })).toBe("#34d399");
    expect(pathColor({ status: "success" })).toBe("#60a5fa");
  });
});
