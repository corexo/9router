// Per-API-key usage tracking: the apiKeys list/detail aggregates must expose
// token sums and (paid-provider) cost, not just request counts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/lib/db/repos/apiKeysRepo.js"), "utf8");

describe("apiKeys usage aggregates", () => {
  it("sums prompt/completion tokens and cost per key in both queries", () => {
    expect(source).toContain("SUM(COALESCE(promptTokens, 0)) as totalPromptTokens");
    expect(source).toContain("SUM(COALESCE(completionTokens, 0)) as totalCompletionTokens");
    expect(source).toContain("SUM(COALESCE(cost, 0)) as totalCost");
    expect(source.match(/SUM\(COALESCE\(promptTokens, 0\)\)/g)).toHaveLength(2); // list + detail
  });

  it("records and exposes the last source IP for a used key", () => {
    expect(source).toContain("lastUsedIp: row.lastUsedIp || null");
    expect(source).toContain("UPDATE apiKeys SET lastUsedIp = ?, lastUsedAt = ?");
    expect(source).toContain("validateApiKeyDetails(key, sourceIp = null)");
  });

  it("exposes the aggregates through rowToKey", () => {
    expect(source).toContain("totalPromptTokens: Number(row.totalPromptTokens || 0)");
    expect(source).toContain("totalCompletionTokens: Number(row.totalCompletionTokens || 0)");
    expect(source).toContain("totalCost: Number(row.totalCost || 0)");
  });
});

describe("apiKeys ownership", () => {
  it("persists ownerUsername on create and maps it in rowToKey", () => {
    expect(source).toContain("ownerUsername: ownerUsername || null");
    expect(source).toContain("ownerUsername: row.ownerUsername || null");
    expect(source).toContain("isActive, createdAt, ownerUsername)");
  });

  it("scopes the keys list for moderators in the route", () => {
    const route = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/app/api/keys/route.js"), "utf8");
    expect(route).toContain('claims?.role === "moderator"');
    expect(route).toContain("k.ownerUsername === claims.username");
    expect(route).toContain("createApiKey(name, machineId, claims?.username || null)");
  });

  it("migration adds the ownerUsername column", () => {
    const migration = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/lib/db/migrations/002-users.js"), "utf8");
    expect(migration).toContain("ALTER TABLE apiKeys ADD COLUMN ownerUsername TEXT");
  });
});
