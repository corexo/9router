import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/lib/db/repos/requestDetailsRepo.js"), "utf8");

describe("requestDetails retention", () => {
  it("prunes rows older than seven days before applying the record cap", () => {
    const prune = source.indexOf("DELETE FROM requestDetails WHERE timestamp < ?");
    const cap = source.indexOf("DELETE FROM requestDetails WHERE id IN");
    expect(source).toContain("const DEFAULT_RETENTION_DAYS = 7;");
    expect(prune).toBeGreaterThan(-1);
    expect(cap).toBeGreaterThan(prune);
    expect(source).toContain("Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000");
  });
});
