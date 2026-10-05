import { getPricingForModel as defaultGetPricingForModel } from "open-sse/providers/pricing.js";

const STORE_KEY = Symbol.for("9router.paidTrafficBalancer");
const REFRESH_KEY = Symbol.for("9router.paidTrafficRefreshLock");
const CACHE_KEY = Symbol.for("9router.paidTrafficUsageCache");
const REFRESH_MS = 10 * 60 * 1000;
const KV_KEY = "distribution";
const MAX_HISTORY = 100;

function store() {
  if (!globalThis[STORE_KEY]) globalThis[STORE_KEY] = { snapshot: null, lastRequestedAt: 0, entries: [] };
  return globalThis[STORE_KEY];
}

export function validatePaidTrafficDistribution(value, accounts) {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const allowed = new Set(accounts.map((account) => account.id));
  const entries = Object.entries(parsed);
  if (!entries.length || entries.some(([id, weight]) => !allowed.has(id) || !Number.isFinite(Number(weight)) || Number(weight) < 0)) return null;
  const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  return Math.abs(total - 100) < 0.01
    ? Object.fromEntries(entries.map(([id, weight]) => [id, Number(weight) / total]))
    : null;
}

function persist() {
  const s = store();
  Promise.resolve().then(async () => {
    try {
      const { makeKv } = await import("../db/helpers/kvStore.js");
      await makeKv("paidTraffic").set(KV_KEY, { snapshot: s.snapshot, lastRequestedAt: s.lastRequestedAt, entries: s.entries });
    } catch {}
  });
}

let hydrationPromise;
export async function hydratePaidTraffic() {
  if (!hydrationPromise) hydrationPromise = (async () => {
    try {
      const { makeKv } = await import("../db/helpers/kvStore.js");
      const saved = await makeKv("paidTraffic").get(KV_KEY);
      if (saved && Number.isFinite(saved.lastRequestedAt)) Object.assign(store(), saved, { entries: Array.isArray(saved.entries) ? saved.entries : [] });
    } catch {}
  })();
  await hydrationPromise;
}

export function isPaidModel(modelId, providerFromModelId, getPricingForModel = defaultGetPricingForModel) {
  if (typeof modelId !== "string" || /(^|:)free(?:$|[-/])/i.test(modelId)) return false;
  const slash = modelId.indexOf("/");
  if (slash < 0) return false;
  const pricing = getPricingForModel(providerFromModelId(modelId), modelId.slice(slash + 1));
  return Number(pricing?.input || 0) > 0 || Number(pricing?.output || 0) > 0;
}

export function accountUsageFingerprint(accounts) {
  return JSON.stringify([...accounts].map(({ id, used, limit, resetAt, sessionStartedAt, sessionDurationMs, usageUpdatedAt }) => ({ id, used, limit, resetAt, sessionStartedAt, sessionDurationMs, usageUpdatedAt })).sort((a, b) => a.id.localeCompare(b.id)));
}

export function shouldRefreshPaidTraffic(snapshot, fingerprint, now = Date.now()) {
  return snapshot.fingerprint !== fingerprint && now - (snapshot.lastRequestedAt ?? 0) >= REFRESH_MS;
}

export async function refreshPaidTrafficOnce(run) {
  const previous = globalThis[REFRESH_KEY] || Promise.resolve();
  let unlock;
  globalThis[REFRESH_KEY] = new Promise((resolve) => { unlock = resolve; });
  await previous;
  try { return await run(); } finally { unlock(); }
}

export function getCachedPaidTrafficSnapshot(provider, now = Date.now()) {
  const cached = globalThis[CACHE_KEY];
  return cached?.provider === provider && now - cached.at < 60_000 ? cached.value : null;
}

export function cachePaidTrafficSnapshot(provider, value, now = Date.now()) {
  globalThis[CACHE_KEY] = { provider, value, at: now };
}

export function markPaidTrafficRequest(snapshot, request, now = Date.now()) {
  const s = store();
  s.lastRequestedAt = now;
  s.snapshot = { ...snapshot, fingerprint: accountUsageFingerprint(snapshot.accounts), requestedAt: now };
  s.entries.unshift({ timestamp: new Date(now).toISOString(), provider: snapshot.provider, request, accounts: snapshot.accounts });
  if (s.entries.length > MAX_HISTORY) s.entries.length = MAX_HISTORY;
  persist();
}

export function finishPaidTrafficRequest(response, selection) {
  const s = store();
  const entry = s.entries[0];
  if (entry) Object.assign(entry, { response, selection, completedAt: new Date().toISOString() });
  persist();
}

export function getPaidTrafficDistribution(provider) {
  return store().entries.find((entry) => entry.provider === provider && entry.selection)?.selection || null;
}

export function getPaidTrafficData() {
  const s = store();
  return { snapshot: s.snapshot, lastRequestedAt: s.lastRequestedAt, entries: s.entries };
}

export function getCachedPaidTrafficDistribution(provider) {
  const entry = store().entries.find((item) => item.provider === provider && item.selection);
  return entry?.selection || null;
}
