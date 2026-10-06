import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const picker = readFileSync(resolve(root, "src/app/api/jev/picker/route.js"), "utf8");
const models = readFileSync(resolve(root, "src/app/api/v1/models/route.js"), "utf8");
const settings = readFileSync(resolve(root, "src/app/api/settings/route.js"), "utf8");

describe("Jev model pool tenant scope", () => {
  it("resolves moderator preferences and scopes available models to their connections", () => {
    expect(picker).toContain('claims?.role === "moderator" && claims.username');
    expect(picker).toContain('getUserPrefs(tenant)');
    expect(picker).toContain('ownerUsername: tenant');
    expect(picker).toContain('if (tenant) for (const key of Object.keys(tenantSettings)) if (key.startsWith("jev")) delete tenantSettings[key]');
    expect(picker).toContain('basePool.filter(tenantVisible)');
    expect(picker).toContain('tenantPoolModels.has(id)');
    expect(models).toContain('(!ownerUsername || c.ownerUsername === ownerUsername)');
    expect(models).toContain('combo.ownerUsername === ownerUsername');
  });

  it("does not return the shared Jev API credential to moderators", () => {
    expect(settings).toContain('USER_SCOPED_SETTING_KEYS');
    expect(settings).toContain('Object.fromEntries(Object.entries(prefs).filter(([key]) => USER_SCOPED_SETTING_KEYS.has(key)))');
    expect(settings).toContain('jevApiKey');
  });
});
