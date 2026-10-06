import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const ALLOWED = new Set(["theme", "locale", "dashboardLayout", "jevPoolModels", "jevFreePoolModels", "jevTierPreference", "jevTierDistributionEnabled", "jevModelTiers", "jevExcludeLocalModels", "jev1mMinContext"]);
export async function getUserPrefs(username) {
  const row = (await getAdapter()).get("SELECT data FROM userPrefs WHERE username = ?", [username]);
  return row ? parseJson(row.data, {}) : {};
}
export async function updateUserPrefs(username, updates = {}) {
  const data = Object.fromEntries(Object.entries(updates).filter(([key]) => ALLOWED.has(key)));
  const db = await getAdapter();
  const current = await getUserPrefs(username);
  const next = { ...current, ...data };
  db.run("INSERT INTO userPrefs(username, data, updatedAt) VALUES(?, ?, ?) ON CONFLICT(username) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt", [username, stringifyJson(next), new Date().toISOString()]);
  return next;
}
