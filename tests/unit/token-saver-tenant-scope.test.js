import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const settingsRoute = readFileSync(resolve(root, "src/app/api/settings/route.js"), "utf8");
const chatRoute = readFileSync(resolve(root, "src/sse/handlers/chat.js"), "utf8");

describe("token-saver tenant settings", () => {
  it("moderator settings response excludes global user-scoped values and overlays their prefs", () => {
    expect(settingsRoute).toContain("for (const key of USER_SCOPED_SETTING_KEYS) delete safeSettings[key]");
    expect(settingsRoute).toContain("USER_SCOPED_SETTING_KEYS.has(key)");
    expect(settingsRoute).toContain('key !== "jevApiKey"');
  });

  it("uses owner-specific token-saver preferences with independent defaults", () => {
    expect(chatRoute).toContain('owner?.role === "moderator"');
    expect(chatRoute).toContain("rtkEnabled: true");
    expect(chatRoute).toContain("headroomEnabled: false");
    expect(chatRoute).toContain("getUserPrefs(apiKeyDetails.ownerUsername)");
  });
});
