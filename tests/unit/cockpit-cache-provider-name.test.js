import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("Cockpit tenant cache providers", () => {
  it("returns a display name for scoped providers and guards the UI fallback", () => {
    const repo = readFileSync(resolve(root, "src/lib/db/repos/usageRepo.js"), "utf8");
    const ui = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/cockpit/CockpitClient.js"), "utf8");
    expect(repo).toContain('name: providerNames[entry.provider] || entry.provider');
    expect(ui).toContain('p.name.split(" ")[0]');
  });
});
