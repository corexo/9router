import { EventEmitter } from "events";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getMeta, setMeta } from "../helpers/metaStore.js";

function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

const PENDING_TIMEOUT_MS = 60 * 1000;
const RING_CAP = 50;
const CONN_CACHE_TTL_MS = 30 * 1000;
const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };

// In-memory state shared across Next.js modules
if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._pendingTimers) global._pendingTimers = {};
if (!global._recentRing) global._recentRing = { items: [], initialized: false };
if (!global._connectionMapCache) global._connectionMapCache = { map: {}, ts: 0 };
if (!global._statsEmitTimers) global._statsEmitTimers = { pending: null, update: null };

const pendingRequests = global._pendingRequests;
const lastErrorProvider = global._lastErrorProvider;
const pendingTimers = global._pendingTimers;
const recentRing = global._recentRing;
const connCache = global._connectionMapCache;
const statsEmitTimers = global._statsEmitTimers;

export const statsEmitter = global._statsEmitter;

function scheduleStatsEvent(event, delayMs = 150) {
  const key = event === "update" ? "update" : "pending";
  if (statsEmitTimers[key]) return;
  statsEmitTimers[key] = setTimeout(() => {
    statsEmitTimers[key] = null;
    statsEmitter.emit(event);
  }, delayMs);
  statsEmitTimers[key]?.unref?.();
}

function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cachedTokens = entry.tokens?.cached_tokens || entry.tokens?.cache_read_input_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cachedTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const apiKeyVal = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKey: entry.apiKey || null } });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
}

function pushToRing(entry) {
  recentRing.items.push(entry);
  if (recentRing.items.length > RING_CAP) {
    recentRing.items = recentRing.items.slice(-RING_CAP);
  }
}

async function getConnectionMapCached() {
  if (Date.now() - connCache.ts < CONN_CACHE_TTL_MS) return connCache.map;
  try {
    const { getProviderConnections } = await import("./connectionsRepo.js");
    const all = await getProviderConnections();
    const map = {};
    for (const c of all) map[c.id] = c.name || c.email || c.id;
    connCache.map = map;
    connCache.ts = Date.now();
  } catch {}
  return connCache.map;
}

async function ensureRingInitialized() {
  if (recentRing.initialized) return;
  recentRing.initialized = true;
  try {
    const db = await getAdapter();
    const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`, [RING_CAP]);
    recentRing.items = rows.reverse().map((r) => ({
      timestamp: r.timestamp, provider: r.provider, model: r.model, connectionId: r.connectionId,
      apiKey: r.apiKey, endpoint: r.endpoint, cost: r.cost, status: r.status,
      tokens: parseJson(r.tokens, {}),
    }));
  } catch {}
}

async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    // Delegate the actual math to the single source of truth (avoids the two
    // copies drifting apart — see open-sse/providers/pricing.js for the
    // cache-inclusive prompt_tokens convention this assumes).
    const { calculateCostFromTokens } = await import("open-sse/providers/pricing.js");
    return calculateCostFromTokens(tokens, pricing);
  } catch (e) {
    console.error("Error calculating cost:", e);
    return 0;
  }
}

export function trackPendingRequest(model, provider, connectionId, started, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));
  if (pendingRequests.byModel[modelKey] === 0) delete pendingRequests.byModel[modelKey];

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey]) pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(0, pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1));
    if (pendingRequests.byAccount[connectionId][modelKey] === 0) {
      delete pendingRequests.byAccount[connectionId][modelKey];
      if (Object.keys(pendingRequests.byAccount[connectionId]).length === 0) {
        delete pendingRequests.byAccount[connectionId];
      }
    }
  }

  if (started) {
    clearTimeout(pendingTimers[timerKey]);
    pendingTimers[timerKey] = setTimeout(() => {
      delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0) pendingRequests.byModel[modelKey] = 0;
      if (connectionId && pendingRequests.byAccount[connectionId]?.[modelKey] > 0) {
        pendingRequests.byAccount[connectionId][modelKey] = 0;
      }
      scheduleStatsEvent("pending");
    }, PENDING_TIMEOUT_MS);
  } else {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  // [PENDING] console line removed; lifecycle is visible via "▶" and "📊 done" lines
  scheduleStatsEvent("pending");
}

export async function getActiveRequests() {
  const activeRequests = [];
  const connectionMap = await getConnectionMapCached();

  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  await ensureRingInitialized();
  const seen = new Set();
  const recentRequests = [...recentRing.items]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((e) => {
      const t = e.tokens || {};
      return {
        timestamp: e.timestamp, model: e.model, provider: e.provider || "",
        connectionId: e.connectionId || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        cachedTokens: t.cached_tokens || t.cache_read_input_tokens || 0,
        status: e.status || "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const errorProvider = (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}

export async function saveRequestUsage(entry) {
  try {
    const db = await getAdapter();

    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost = entry.cost ?? await calculateCost(entry.provider, entry.model, entry.tokens);

    const tokens = entry.tokens || {};
    const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;

    let inserted = false;

    // All 3 writes (history insert, daily upsert, lifetime counter) in ONE transaction.
    // better-sqlite3 is sync → no JS yield mid-transaction → no race in same process.
    db.transaction(() => {
      const existing = db.get(
        `SELECT id, endpoint FROM usageHistory
         WHERE timestamp = ?
           AND COALESCE(provider, '') = COALESCE(?, '')
           AND COALESCE(model, '') = COALESCE(?, '')
           AND COALESCE(connectionId, '') = COALESCE(?, '')
           AND COALESCE(apiKey, '') = COALESCE(?, '')
           AND promptTokens = ?
           AND completionTokens = ?
         ORDER BY id DESC LIMIT 1`,
        [
          entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null,
          promptTokens, completionTokens,
        ]
      );

      if (existing) {
        if (!existing.endpoint && entry.endpoint) {
          db.run(`UPDATE usageHistory SET endpoint = ? WHERE id = ?`, [entry.endpoint, existing.id]);
        }
        return;
      }

      db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
          promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
          stringifyJson(tokens), stringifyJson(entry.meta || {}),
        ]
      );

      const dateKey = getLocalDateKey(entry.timestamp);
      const row = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
      const day = row ? parseJson(row.data, {}) : {
        requests: 0, promptTokens: 0, completionTokens: 0, cost: 0,
        byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
      };
      aggregateEntryToDay(day, entry);
      db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, stringifyJson(day)]);

      // Atomic counter increment in same transaction
      const cur = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`);
      const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(next)]);
      inserted = true;
    });

    if (inserted) {
      pushToRing(entry);
      scheduleStatsEvent("update", 250);
    }
  } catch (e) {
    console.error("Failed to save usage stats:", e);
  }
}

export async function getUsageHistory(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ${where} ORDER BY id ASC`, params);

  return rows.map((r) => ({
    timestamp: r.timestamp, provider: r.provider, model: r.model,
    connectionId: r.connectionId, apiKeyMasked: maskApiKey(r.apiKey), endpoint: r.endpoint,
    cost: r.cost, status: r.status, tokens: parseJson(r.tokens, {}),
  }));
}

function loadDaysInRange(adapter, maxDays) {
  if (maxDays == null) {
    return adapter.all(`SELECT dateKey, data FROM usageDaily`);
  }
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - maxDays + 1);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  return adapter.all(`SELECT dateKey, data FROM usageDaily WHERE dateKey >= ?`, [cutoffKey]);
}

export async function getUsageStats(period = "all") {
  const db = await getAdapter();

  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }] = await Promise.all([
    import("./connectionsRepo.js"),
    import("./apiKeysRepo.js"),
    import("./nodesRepo.js"),
  ]);

  let allConnections = [];
  try { allConnections = await getProviderConnections(); } catch {}
  const connectionMap = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap = {};
  try {
    const nodes = await getProviderNodes();
    for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
  } catch {}

  let allApiKeys = [];
  try { allApiKeys = await getApiKeys(); } catch {}
  const apiKeyMap = {};
  for (const k of allApiKeys) apiKeyMap[k.key] = { name: k.name, id: k.id, createdAt: k.createdAt };

  // recentRequests from live history (last 100 entries enough for 20 deduped)
  const recentRows = db.all(`SELECT timestamp, provider, model, tokens, status FROM usageHistory ORDER BY id DESC LIMIT 100`);
  const seen = new Set();
  const recentRequests = recentRows
    .map((r) => {
      const t = parseJson(r.tokens, {}) || {};
      return {
        timestamp: r.timestamp, model: r.model, provider: r.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        cachedTokens: t.cached_tokens || t.cache_read_input_tokens || 0,
        status: r.status || "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const stats = {
    totalRequests: 0,
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    recentRequests,
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
  };

  // Active requests
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        stats.activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  // last10Minutes — query 10min window
  const now = new Date();
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);
  const bucketMap = {};
  for (let i = 0; i < 10; i++) {
    const ts = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[ts] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[ts]);
  }
  const recent10 = db.all(
    `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
    [tenMinutesAgo.toISOString(), now.toISOString()]
  );
  for (const r of recent10) {
    const tt = new Date(r.timestamp).getTime();
    const minuteStart = Math.floor(tt / 60000) * 60000;
    if (bucketMap[minuteStart]) {
      bucketMap[minuteStart].requests++;
      bucketMap[minuteStart].promptTokens += r.promptTokens || 0;
      bucketMap[minuteStart].completionTokens += r.completionTokens || 0;
      bucketMap[minuteStart].cost += r.cost || 0;
    }
  }

  const useDailySummary = period !== "24h" && period !== "today";

  if (useDailySummary) {
    const periodDays = { "7d": 7, "30d": 30, "60d": 60 };
    const maxDays = periodDays[period] || null;
    const dayRows = loadDaysInRange(db, maxDays);

    for (const dr of dayRows) {
      const dateKey = dr.dateKey;
      const day = parseJson(dr.data, {});
      stats.totalPromptTokens += day.promptTokens || 0;
      stats.totalCompletionTokens += day.completionTokens || 0;
      stats.totalCachedTokens += day.cachedTokens || 0;
      stats.totalCost += day.cost || 0;

      for (const [prov, p] of Object.entries(day.byProvider || {})) {
        if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
        stats.byProvider[prov].requests += p.requests || 0;
        stats.byProvider[prov].promptTokens += p.promptTokens || 0;
        stats.byProvider[prov].completionTokens += p.completionTokens || 0;
        stats.byProvider[prov].cachedTokens += p.cachedTokens || 0;
        stats.byProvider[prov].cost += p.cost || 0;
      }

      for (const [mk, m] of Object.entries(day.byModel || {})) {
        const rawModel = m.rawModel || mk.split("|")[0];
        const provider = m.provider || mk.split("|")[1] || "";
        const statsKey = provider ? `${rawModel} (${provider})` : rawModel;
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byModel[statsKey]) {
          stats.byModel[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, lastUsed: dateKey };
        }
        stats.byModel[statsKey].requests += m.requests || 0;
        stats.byModel[statsKey].promptTokens += m.promptTokens || 0;
        stats.byModel[statsKey].completionTokens += m.completionTokens || 0;
        stats.byModel[statsKey].cachedTokens += m.cachedTokens || 0;
        stats.byModel[statsKey].cost += m.cost || 0;
        if (dateKey > (stats.byModel[statsKey].lastUsed || "")) stats.byModel[statsKey].lastUsed = dateKey;
      }

      for (const [connId, a] of Object.entries(day.byAccount || {})) {
        const accountName = connectionMap[connId] || `Account ${connId.slice(0, 8)}...`;
        const rawModel = a.rawModel || "";
        const provider = a.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const accountKey = `${rawModel} (${provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, connectionId: connId, accountName, lastUsed: dateKey };
        }
        stats.byAccount[accountKey].requests += a.requests || 0;
        stats.byAccount[accountKey].promptTokens += a.promptTokens || 0;
        stats.byAccount[accountKey].completionTokens += a.completionTokens || 0;
        stats.byAccount[accountKey].cachedTokens += a.cachedTokens || 0;
        stats.byAccount[accountKey].cost += a.cost || 0;
        if (dateKey > (stats.byAccount[accountKey].lastUsed || "")) stats.byAccount[accountKey].lastUsed = dateKey;
      }

      for (const [akKey, ak] of Object.entries(day.byApiKey || {})) {
        const rawModel = ak.rawModel || "";
        const provider = ak.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const apiKeyVal = ak.apiKey;
        const keyInfo = apiKeyVal ? apiKeyMap[apiKeyVal] : null;
        const keyName = keyInfo?.name || (apiKeyVal ? apiKeyVal.slice(0, 8) + "..." : "Local (No API Key)");
        const apiKeyMasked = maskApiKey(apiKeyVal);
        const apiKeyKey = apiKeyMasked || "local-no-key";
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey, lastUsed: dateKey };
        }
        stats.byApiKey[akKey].requests += ak.requests || 0;
        stats.byApiKey[akKey].promptTokens += ak.promptTokens || 0;
        stats.byApiKey[akKey].completionTokens += ak.completionTokens || 0;
        stats.byApiKey[akKey].cachedTokens += ak.cachedTokens || 0;
        stats.byApiKey[akKey].cost += ak.cost || 0;
        if (dateKey > (stats.byApiKey[akKey].lastUsed || "")) stats.byApiKey[akKey].lastUsed = dateKey;
      }

      for (const [epKey, ep] of Object.entries(day.byEndpoint || {})) {
        const endpoint = ep.endpoint || epKey.split("|")[0] || "Unknown";
        const rawModel = ep.rawModel || "";
        const provider = ep.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byEndpoint[epKey]) {
          stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel, provider: providerDisplayName, lastUsed: dateKey };
        }
        stats.byEndpoint[epKey].requests += ep.requests || 0;
        stats.byEndpoint[epKey].promptTokens += ep.promptTokens || 0;
        stats.byEndpoint[epKey].completionTokens += ep.completionTokens || 0;
        stats.byEndpoint[epKey].cachedTokens += ep.cachedTokens || 0;
        stats.byEndpoint[epKey].cost += ep.cost || 0;
        if (dateKey > (stats.byEndpoint[epKey].lastUsed || "")) stats.byEndpoint[epKey].lastUsed = dateKey;
      }
    }

    // Overlay precise lastUsed timestamps from history
    const overlayCutoff = maxDays ? Date.now() - maxDays * 86400000 : 0;
    const histRows = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint FROM usageHistory WHERE timestamp >= ?`,
      [new Date(overlayCutoff).toISOString()]
    );
    for (const e of histRows) {
      const ts = e.timestamp;
      const modelKey = e.provider ? `${e.model} (${e.provider})` : e.model;
      if (stats.byModel[modelKey] && new Date(ts) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = ts;

      if (e.connectionId) {
        const accountName = connectionMap[e.connectionId] || `Account ${e.connectionId.slice(0, 8)}...`;
        const accountKey = `${e.model} (${e.provider} - ${accountName})`;
        if (stats.byAccount[accountKey] && new Date(ts) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = ts;
      }

      const apiKeyKey = (e.apiKey && typeof e.apiKey === "string")
        ? `${e.apiKey}|${e.model}|${e.provider || "unknown"}`
        : "local-no-key";
      if (stats.byApiKey[apiKeyKey] && new Date(ts) > new Date(stats.byApiKey[apiKeyKey].lastUsed)) stats.byApiKey[apiKeyKey].lastUsed = ts;

      const endpoint = e.endpoint || "Unknown";
      const endpointKey = `${endpoint}|${e.model}|${e.provider || "unknown"}`;
      if (stats.byEndpoint[endpointKey] && new Date(ts) > new Date(stats.byEndpoint[endpointKey].lastUsed)) stats.byEndpoint[endpointKey].lastUsed = ts;
    }
  } else {
    // 24h / today: live history
    let cutoff;
    if (period === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      cutoff = startOfDay.toISOString();
    } else {
      cutoff = new Date(Date.now() - PERIOD_MS["24h"]).toISOString();
    }
    const filtered = db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ?`,
      [cutoff]
    );

    for (const r of filtered) {
      const tokens = parseJson(r.tokens, {}) || {};
      const promptTokens = tokens.prompt_tokens || 0;
      const completionTokens = tokens.completion_tokens || 0;
      const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
      const entryCost = r.cost || 0;
      const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;

      stats.totalPromptTokens += promptTokens;
      stats.totalCompletionTokens += completionTokens;
      stats.totalCachedTokens += cachedTokens;
      stats.totalCost += entryCost;

      if (!stats.byProvider[r.provider]) stats.byProvider[r.provider] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
      stats.byProvider[r.provider].requests++;
      stats.byProvider[r.provider].promptTokens += promptTokens;
      stats.byProvider[r.provider].completionTokens += completionTokens;
      stats.byProvider[r.provider].cachedTokens += cachedTokens;
      stats.byProvider[r.provider].cost += entryCost;

      const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
      if (!stats.byModel[modelKey]) {
        stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      stats.byModel[modelKey].requests++;
      stats.byModel[modelKey].promptTokens += promptTokens;
      stats.byModel[modelKey].completionTokens += completionTokens;
      stats.byModel[modelKey].cachedTokens += cachedTokens;
      stats.byModel[modelKey].cost += entryCost;
      if (new Date(r.timestamp) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = r.timestamp;

      if (r.connectionId) {
        const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
        const accountKey = `${r.model} (${r.provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, connectionId: r.connectionId, accountName, lastUsed: r.timestamp };
        }
        stats.byAccount[accountKey].requests++;
        stats.byAccount[accountKey].promptTokens += promptTokens;
        stats.byAccount[accountKey].completionTokens += completionTokens;
        stats.byAccount[accountKey].cachedTokens += cachedTokens;
        stats.byAccount[accountKey].cost += entryCost;
        if (new Date(r.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = r.timestamp;
      }

      if (r.apiKey && typeof r.apiKey === "string") {
        const keyInfo = apiKeyMap[r.apiKey];
        const keyName = keyInfo?.name || r.apiKey.slice(0, 8) + "...";
        const apiKeyMasked = maskApiKey(r.apiKey);
        const akKey = `${apiKeyMasked}|${r.model}|${r.provider || "unknown"}`;
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey: apiKeyMasked, lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey[akKey];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      } else {
        if (!stats.byApiKey["local-no-key"]) {
          stats.byApiKey["local-no-key"] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKeyMasked: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey["local-no-key"];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      }

      const endpoint = r.endpoint || "Unknown";
      const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byEndpoint[epKey]) {
        stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      const epe = stats.byEndpoint[epKey];
      epe.requests++; epe.promptTokens += promptTokens; epe.completionTokens += completionTokens; epe.cachedTokens += cachedTokens; epe.cost += entryCost;
      if (new Date(r.timestamp) > new Date(epe.lastUsed)) epe.lastUsed = r.timestamp;
    }
  }

  stats.totalRequests = Object.values(stats.byProvider).reduce((sum, p) => sum + (p.requests || 0), 0);
  return stats;
}

export async function getChartData(period = "7d") {
  const db = await getAdapter();
  const now = Date.now();

  if (period === "today") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTime = startOfDay.getTime();
    const endTime = startTime + bucketCount * bucketMs;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t >= endTime) continue;
      const idx = Math.floor((t - startTime) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
        buckets[idx].cost += r.cost || 0;
      }
    }
    return buckets;
  }

  if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const startTime = now - bucketCount * bucketMs;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t > now) continue;
      const idx = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
      buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
      buckets[idx].cost += r.cost || 0;
    }
    return buckets;
  }

  const bucketCount = period === "7d" ? 7 : period === "30d" ? 30 : 60;
  const today = new Date();
  const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Build map of dateKey → day data
  const dayRows = loadDaysInRange(db, bucketCount);
  const dayMap = {};
  for (const r of dayRows) dayMap[r.dateKey] = parseJson(r.data, {});

  return Array.from({ length: bucketCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (bucketCount - 1 - i));
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayData = dayMap[dateKey];
    return {
      label: labelFn(d),
      tokens: dayData ? (dayData.promptTokens || 0) + (dayData.completionTokens || 0) : 0,
      cost: dayData ? (dayData.cost || 0) : 0,
    };
  });
}

export async function getTokenFlowData(range = "1h") {
  const db = await getAdapter();
  const now = Date.now();

  const CONFIGS = {
    "1h": { durationMs: 3600000, bucketMs: 60000, count: 60, timeFormat: "time" },
    "3h": { durationMs: 3 * 3600000, bucketMs: 300000, count: 36, timeFormat: "time" },
    "6h": { durationMs: 6 * 3600000, bucketMs: 600000, count: 36, timeFormat: "time" },
    "12h": { durationMs: 12 * 3600000, bucketMs: 1200000, count: 36, timeFormat: "time" },
    "24h": { durationMs: 24 * 3600000, bucketMs: 1800000, count: 48, timeFormat: "time" },
    "3d": { durationMs: 3 * 86400000, bucketMs: 7200000, count: 36, timeFormat: "datetime" },
  };

  const config = CONFIGS[range] || CONFIGS["1h"];
  const { durationMs, bucketMs, count, timeFormat } = config;
  const startTime = now - durationMs;

  const labelFn = (ts) => {
    const d = new Date(ts);
    if (timeFormat === "datetime") {
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const mins = String(d.getMinutes()).padStart(2, "0");
      return `${day}.${month} ${hours}:${mins}`;
    }
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${hours}:${mins}`;
  };

  const buckets = Array.from({ length: count }, (_, i) => {
    const bucketTs = startTime + i * bucketMs;
    return {
      time: labelFn(bucketTs),
      timestamp: bucketTs,
      tokensIn: 0,
      tokensOut: 0,
      requests: 0,
    };
  });

  const rows = db.all(
    `SELECT timestamp, promptTokens, completionTokens FROM usageHistory WHERE timestamp >= ? ORDER BY id ASC`,
    [new Date(startTime).toISOString()]
  );

  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalRequests = 0;

  for (const r of rows) {
    const t = new Date(r.timestamp).getTime();
    if (t < startTime || t > now) continue;
    const idx = Math.min(Math.floor((t - startTime) / bucketMs), count - 1);
    if (idx >= 0 && idx < count) {
      const pIn = Number(r.promptTokens || 0);
      const pOut = Number(r.completionTokens || 0);
      buckets[idx].tokensIn += pIn;
      buckets[idx].tokensOut += pOut;
      buckets[idx].requests += 1;
      totalTokensIn += pIn;
      totalTokensOut += pOut;
      totalRequests += 1;
    }
  }

  return {
    range,
    totalTokensIn,
    totalTokensOut,
    totalRequests,
    points: buckets,
  };
}

function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// No-op: request log is now derived from usageHistory table on read.
export async function appendRequestLog() {}

export async function getRecentLogs(limit = 200) {
  try {
    const db = await getAdapter();
    const rows = db.all(
      `SELECT timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
      [limit],
    );
    if (!rows.length) return [];

    const connMap = {};
    try {
      const { getProviderConnections } = await import("./connectionsRepo.js");
      const connections = await getProviderConnections();
      for (const c of connections) connMap[c.id] = c.name || c.email || "";
    } catch {}

    return rows.map((r) => {
      const ts = formatLogDate(new Date(r.timestamp));
      const p = r.provider?.toUpperCase() || "-";
      const m = r.model || "-";
      const account = connMap[r.connectionId] || (r.connectionId ? r.connectionId.slice(0, 8) : "-");
      const tk = r.tokens ? parseJson(r.tokens, {}) : {};
      const sent = r.promptTokens ?? tk.prompt_tokens ?? "-";
      const received = r.completionTokens ?? tk.completion_tokens ?? "-";
      return `${ts} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${r.status || "-"}`;
    });
  } catch (e) {
    console.error("[usageRepo] getRecentLogs failed:", e.message);
    return [];
  }
}

function buildJevSeries(rows, days) {
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    buckets.set(key, { date: key, requests: 0, success: 0, fallbacks: 0, credits: 0, tokens: 0, latencySum: 0, latencyCount: 0 });
  }
  for (const row of rows) {
    const key = String(row.timestamp).slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const meta = parseJson(row.meta, {}) || {};
    bucket.requests += 1;
    if (row.status === "success") bucket.success += 1;
    else bucket.fallbacks += 1;
    bucket.credits += Number(row.cost) || 0;
    bucket.tokens += Number(meta.tokens ?? 0);
    if (typeof meta.latencyMs === "number") { bucket.latencySum += meta.latencyMs; bucket.latencyCount += 1; }
  }
  return [...buckets.values()].map((bucket) => ({
    date: bucket.date,
    requests: bucket.requests,
    success: bucket.success,
    fallbacks: bucket.fallbacks,
    credits: Number(bucket.credits.toFixed(8)),
    tokens: bucket.tokens,
    avgLatencyMs: bucket.latencyCount ? Math.round(bucket.latencySum / bucket.latencyCount) : 0,
  }));
}

export async function getJevStats(period = "7d", ownerUsername = null) {
  try {
    const db = await getAdapter();
    const days = { today: 1, "24h": 1, "7d": 7, "30d": 30, "60d": 60 }[period] || 7;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const rows = db.all(
      `SELECT timestamp, endpoint, cost, status, meta FROM usageHistory WHERE provider = 'jev' AND timestamp >= ?${ownerUsername ? " AND apiKey IN (SELECT key FROM apiKeys WHERE ownerUsername = ?)" : ""} ORDER BY id ASC`,
      ownerUsername ? [since, ownerUsername] : [since]
    );
    const stats = { requests: 0, success: 0, fallbacks: 0, credits: 0, tokens: 0, promptTokens: 0, completionTokens: 0, latencySumMs: 0, latencyCount: 0, callers: {}, choices: {} };
    for (const row of rows) {
      const meta = parseJson(row.meta, {}) || {};
      stats.requests += 1;
      if (row.status === "success") stats.success += 1;
      else stats.fallbacks += 1;
      stats.credits += Number(row.cost) || 0;
      const total = Number(meta.tokens ?? 0);
      stats.tokens += total;
      stats.promptTokens += Number(meta.promptTokens ?? 0);
      stats.completionTokens += Number(meta.completionTokens ?? 0);
      if (typeof meta.latencyMs === "number") { stats.latencySumMs += meta.latencyMs; stats.latencyCount += 1; }
      if (meta.caller) stats.callers[meta.caller] = (stats.callers[meta.caller] || 0) + 1;
      if (meta.choice) stats.choices[meta.choice] = (stats.choices[meta.choice] || 0) + 1;
    }
    stats.series = buildJevSeries(rows, days);
    stats.avgLatencyMs = stats.latencyCount ? Math.round(stats.latencySumMs / stats.latencyCount) : 0;
    stats.successRate = stats.requests ? Math.round((stats.success / stats.requests) * 100) : 100;
    stats.topChoices = Object.entries(stats.choices).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([model, count]) => ({ model, count }));
    stats.choices = stats.choices;
    return stats;
  } catch (e) {
    console.error("[usageRepo] getJevStats failed:", e.message);
    return { requests: 0, success: 0, fallbacks: 0, credits: 0, tokens: 0, avgLatencyMs: 0, successRate: 100, callers: {}, choices: {}, topChoices: [], series: [] };
  }
}

export async function getCacheStats(period = "7d", ownerUsername = null) {
  try {
    const db = await getAdapter();
    const now = Date.now();

    if (ownerUsername) {
      const days = period === "today" ? 1 : period === "24h" ? 1 : period === "30d" ? 30 : period === "60d" ? 60 : 7;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const rows = db.all(`SELECT timestamp, provider, model, promptTokens, completionTokens, tokens FROM usageHistory WHERE timestamp >= ? AND apiKey IN (SELECT key FROM apiKeys WHERE ownerUsername = ?)`, [since, ownerUsername]);
      let totalPromptTokens = 0;
      let totalCachedTokens = 0;
      let totalCompletionTokens = 0;
      const byProviderMap = new Map();
      for (const row of rows) {
        const tok = parseJson(row.tokens, {}) || {};
        const prompt = Number(row.promptTokens || tok.prompt_tokens || tok.input_tokens || 0);
        const cached = Number(tok.cached_tokens || tok.cache_read_input_tokens || 0);
        const completion = Number(row.completionTokens || tok.completion_tokens || tok.output_tokens || 0);
        totalPromptTokens += prompt;
        totalCachedTokens += cached;
        totalCompletionTokens += completion;
        const provider = row.provider || "other";
        const entry = byProviderMap.get(provider) || { provider, promptTokens: 0, cachedTokens: 0, uncachedTokens: 0, hitRate: 0, requests: 0 };
        entry.promptTokens += prompt;
        entry.cachedTokens += cached;
        entry.uncachedTokens += Math.max(0, prompt - cached);
        entry.requests += 1;
        byProviderMap.set(provider, entry);
      }
      const byProvider = [...byProviderMap.values()].map((entry) => ({ ...entry, hitRate: entry.promptTokens ? Number(((entry.cachedTokens / entry.promptTokens) * 100).toFixed(1)) : 0 }));
      return {
        period,
        summary: { totalPromptTokens, totalCachedTokens, totalCompletionTokens, overallHitRate: totalPromptTokens ? Number(((totalCachedTokens / totalPromptTokens) * 100).toFixed(1)) : 0, totalRequests: rows.length, cachedRequests: rows.filter((row) => { const t = parseJson(row.tokens, {}) || {}; return Number(t.cached_tokens || t.cache_read_input_tokens || 0) > 0; }).length, estimatedSavingsUsd: Number(((totalCachedTokens / 1000000) * 2.7).toFixed(2)) },
        timeSeries: [], byProvider, byModel: [], recentRequests: [],
      };
    }

    const providerNames = {
      claude: "Claude (Anthropic)",
      glm: "Z.ai (GLM)",
      codex: "ChatGPT (OpenAI Codex)",
      gemini: "Google Gemini",
      opencode: "OpenCode",
      ollama: "Ollama",
      "cloudflare-ai": "Cloudflare AI",
      github: "GitHub Models",
      nvidia: "NVIDIA NIM",
    };

    const providerColors = {
      claude: "#D97706",
      glm: "#2563EB",
      codex: "#10B981",
      gemini: "#8B5CF6",
      opencode: "#EC4899",
      ollama: "#64748B",
      "cloudflare-ai": "#F97316",
      github: "#1F2937",
      nvidia: "#76B900",
    };

    let totalPromptTokens = 0;
    let totalCachedTokens = 0;
    let totalCompletionTokens = 0;
    let totalRequests = 0;
    let cachedRequests = 0;
    let totalCost = 0;

    const providerMap = {};
    const modelMap = {};
    let timeSeries = [];

    if (period === "today" || period === "24h") {
      const bucketCount = 24;
      const bucketMs = 3600000;
      let startTime;
      let endTime;
      let labelFn;

      if (period === "today") {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        startTime = startOfDay.getTime();
        endTime = startTime + bucketCount * bucketMs;
        labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      } else {
        startTime = now - bucketCount * bucketMs;
        endTime = now;
        labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      }

      const buckets = Array.from({ length: bucketCount }, (_, i) => ({
        label: labelFn(startTime + i * bucketMs),
        promptTokens: 0,
        cachedTokens: 0,
        uncachedTokens: 0,
        hitRate: 0,
        requests: 0,
      }));

      const rows = db.all(
        `SELECT timestamp, provider, model, promptTokens, completionTokens, tokens, cost FROM usageHistory WHERE timestamp >= ?${ownerUsername ? " AND apiKey IN (SELECT key FROM apiKeys WHERE ownerUsername = ?)" : ""}`,
        ownerUsername ? [new Date(startTime).toISOString(), ownerUsername] : [new Date(startTime).toISOString()]
      );

      for (const r of rows) {
        const t = new Date(r.timestamp).getTime();
        if (t < startTime || t > endTime) continue;

        const tok = parseJson(r.tokens, {}) || {};
        const cached = Number(tok.cached_tokens || tok.cache_read_input_tokens || 0);
        const prompt = Number(r.promptTokens || tok.prompt_tokens || tok.input_tokens || 0);
        const completion = Number(r.completionTokens || tok.completion_tokens || tok.output_tokens || 0);
        const cost = Number(r.cost || 0);
        const p = r.provider || "other";
        const m = r.model || "unknown";

        totalPromptTokens += prompt;
        totalCachedTokens += cached;
        totalCompletionTokens += completion;
        totalRequests += 1;
        if (cached > 0) cachedRequests += 1;
        totalCost += cost;

        const idx = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
        if (idx >= 0 && idx < bucketCount) {
          buckets[idx].promptTokens += prompt;
          buckets[idx].cachedTokens += cached;
          buckets[idx].uncachedTokens += Math.max(0, prompt - cached);
          buckets[idx].requests += 1;
        }

        if (!providerMap[p]) {
          providerMap[p] = { promptTokens: 0, cachedTokens: 0, completionTokens: 0, requests: 0, cachedRequests: 0, cost: 0 };
        }
        providerMap[p].promptTokens += prompt;
        providerMap[p].cachedTokens += cached;
        providerMap[p].completionTokens += completion;
        providerMap[p].requests += 1;
        if (cached > 0) providerMap[p].cachedRequests += 1;
        providerMap[p].cost += cost;

        if (!modelMap[m]) {
          modelMap[m] = { provider: p, promptTokens: 0, cachedTokens: 0, requests: 0, cachedRequests: 0 };
        }
        modelMap[m].promptTokens += prompt;
        modelMap[m].cachedTokens += cached;
        modelMap[m].requests += 1;
        if (cached > 0) modelMap[m].cachedRequests += 1;
      }

      for (const b of buckets) {
        b.hitRate = b.promptTokens > 0 ? Number(((b.cachedTokens / b.promptTokens) * 100).toFixed(1)) : 0;
      }
      timeSeries = buckets;
    } else {
      const bucketCount = period === "30d" ? 30 : period === "60d" ? 60 : 7;
      const dayRows = ownerUsername
        ? [] // daily rollups are global; never expose another tenant's aggregates
        : loadDaysInRange(db, bucketCount);
      const dayMap = {};
      for (const r of dayRows) dayMap[r.dateKey] = parseJson(r.data, {});

      const today = new Date();
      const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

      timeSeries = Array.from({ length: bucketCount }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (bucketCount - 1 - i));
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const day = dayMap[dateKey];
        const prompt = day?.promptTokens || 0;
        const cached = day?.cachedTokens || 0;
        const uncached = Math.max(0, prompt - cached);
        const hitRate = prompt > 0 ? Number(((cached / prompt) * 100).toFixed(1)) : 0;

        if (day) {
          totalPromptTokens += prompt;
          totalCachedTokens += cached;
          totalCompletionTokens += (day.completionTokens || 0);
          totalRequests += (day.requests || 0);
          totalCost += (day.cost || 0);

          for (const [p, s] of Object.entries(day.byProvider || {})) {
            if (!providerMap[p]) {
              providerMap[p] = { promptTokens: 0, cachedTokens: 0, requests: 0, cachedRequests: 0, cost: 0 };
            }
            providerMap[p].promptTokens += s.promptTokens || 0;
            providerMap[p].cachedTokens += s.cachedTokens || 0;
            providerMap[p].requests += s.requests || 0;
            if ((s.cachedTokens || 0) > 0) providerMap[p].cachedRequests += (s.requests || 0);
            providerMap[p].cost += s.cost || 0;
          }

          for (const [mKey, s] of Object.entries(day.byModel || {})) {
            const rawM = s.meta?.rawModel || mKey.split("|")[0];
            const p = s.meta?.provider || mKey.split("|")[1] || "";
            if (!modelMap[rawM]) {
              modelMap[rawM] = { provider: p, promptTokens: 0, cachedTokens: 0, requests: 0 };
            }
            modelMap[rawM].promptTokens += s.promptTokens || 0;
            modelMap[rawM].cachedTokens += s.cachedTokens || 0;
            modelMap[rawM].requests += s.requests || 0;
          }
        }

        return {
          label: labelFn(d),
          dateKey,
          promptTokens: prompt,
          cachedTokens: cached,
          uncachedTokens: uncached,
          hitRate,
          requests: day?.requests || 0,
        };
      });
    }

    const byProvider = Object.entries(providerMap)
      .filter(([_, s]) => s.promptTokens > 0 || s.cachedTokens > 0)
      .map(([p, s]) => ({
        provider: p,
        name: providerNames[p] || p,
        promptTokens: s.promptTokens,
        cachedTokens: s.cachedTokens,
        uncachedTokens: Math.max(0, s.promptTokens - s.cachedTokens),
        hitRate: s.promptTokens > 0 ? Number(((s.cachedTokens / s.promptTokens) * 100).toFixed(1)) : 0,
        requests: s.requests,
        cachedRequests: s.cachedRequests,
        color: providerColors[p] || "#94A3B8",
      }))
      .sort((a, b) => b.cachedTokens - a.cachedTokens);

    const byModel = Object.entries(modelMap)
      .filter(([_, s]) => s.promptTokens > 0 || s.cachedTokens > 0)
      .map(([m, s]) => ({
        model: m,
        provider: s.provider,
        promptTokens: s.promptTokens,
        cachedTokens: s.cachedTokens,
        uncachedTokens: Math.max(0, s.promptTokens - s.cachedTokens),
        hitRate: s.promptTokens > 0 ? Number(((s.cachedTokens / s.promptTokens) * 100).toFixed(1)) : 0,
        requests: s.requests,
      }))
      .sort((a, b) => b.cachedTokens - a.cachedTokens)
      .slice(0, 10);

    let recentRequests = [];
    try {
      const rdRows = db.all(`SELECT id, timestamp, provider, model, connectionId, data FROM requestDetails ORDER BY timestamp DESC LIMIT 100`)
        .filter((row) => !ownerUsername || ownConnectionIds.has(row.connectionId))
        .slice(0, 20);
      recentRequests = rdRows.map((r) => {
        const d = parseJson(r.data, {}) || {};
        const tok = d.tokens || {};
        const cached = Number(tok.cached_tokens || tok.cache_read_input_tokens || 0);
        const prompt = Number(tok.prompt_tokens || tok.input_tokens || 0);
        const cacheCreation = Number(tok.cache_creation_input_tokens || 0);
        const completion = Number(tok.completion_tokens || tok.output_tokens || 0);
        const hitRate = prompt > 0 && cached > 0 ? Number(((cached / prompt) * 100).toFixed(1)) : 0;
        return {
          id: r.id,
          timestamp: r.timestamp,
          provider: r.provider,
          providerName: providerNames[r.provider] || r.provider,
          model: r.model,
          promptTokens: prompt,
          cachedTokens: cached,
          cacheCreationTokens: cacheCreation,
          completionTokens: completion,
          hitRate,
          isCached: cached > 0,
          latency: d.latency?.total || 0,
        };
      });
    } catch (e) {
      console.error("[usageRepo] failed to fetch recentRequests for cache stats:", e);
    }

    const overallHitRate = totalPromptTokens > 0
      ? Number(((totalCachedTokens / totalPromptTokens) * 100).toFixed(1))
      : 0;

    const estimatedSavingsUsd = Number(((totalCachedTokens / 1000000) * 2.7).toFixed(2));

    return {
      period,
      summary: {
        totalPromptTokens,
        totalCachedTokens,
        totalCompletionTokens,
        overallHitRate,
        totalRequests,
        cachedRequests,
        estimatedSavingsUsd,
      },
      timeSeries,
      byProvider,
      byModel,
      recentRequests,
    };
  } catch (e) {
    console.error("[usageRepo] getCacheStats failed:", e);
    return {
      period,
      summary: { totalPromptTokens: 0, totalCachedTokens: 0, overallHitRate: 0, totalRequests: 0, cachedRequests: 0, estimatedSavingsUsd: 0 },
      timeSeries: [],
      byProvider: [],
      byModel: [],
      recentRequests: [],
    };
  }
}

export async function getCockpitData(period = "7d", ownerUsername = null) {
  try {
    const [jevStats, cacheStats] = await Promise.all([
      getJevStats(period, ownerUsername),
      getCacheStats(period, ownerUsername),
    ]);

    const { getProviderConnections } = await import("./connectionsRepo.js");
    const allConnections = await getProviderConnections();
    const connections = ownerUsername
      ? allConnections.filter((connection) => connection.ownerUsername === ownerUsername)
      : allConnections;
    const ownConnectionIds = new Set(connections.map((connection) => connection.id));

    const db = await getAdapter();
    const accountUsage = {};

    if (period === "today" || period === "24h") {
      const bucketMs = period === "today" ? (Date.now() - new Date().setHours(0, 0, 0, 0)) : (24 * 3600000);
      const since = new Date(Date.now() - bucketMs).toISOString();
      const rows = db.all(
        `SELECT connectionId, promptTokens, completionTokens, tokens, cost FROM usageHistory WHERE timestamp >= ? AND connectionId IS NOT NULL${ownerUsername ? " AND connectionId IN (SELECT id FROM providerConnections WHERE ownerUsername = ?)" : ""}`,
        ownerUsername ? [since, ownerUsername] : [since]
      );
      for (const r of rows) {
        const cId = r.connectionId;
        if (!accountUsage[cId]) {
          accountUsage[cId] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
        }
        const tok = parseJson(r.tokens, {}) || {};
        const cached = Number(tok.cached_tokens || tok.cache_read_input_tokens || 0);
        const prompt = Number(r.promptTokens || tok.prompt_tokens || tok.input_tokens || 0);
        const completion = Number(r.completionTokens || tok.completion_tokens || tok.output_tokens || 0);
        accountUsage[cId].requests += 1;
        accountUsage[cId].promptTokens += prompt;
        accountUsage[cId].completionTokens += completion;
        accountUsage[cId].cachedTokens += cached;
        accountUsage[cId].cost += Number(r.cost || 0);
      }
    } else if (ownerUsername) {
      const days = period === "30d" ? 30 : period === "60d" ? 60 : 7;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const rows = db.all(
        `SELECT timestamp, connectionId, promptTokens, completionTokens, tokens, cost FROM usageHistory WHERE timestamp >= ? AND connectionId IN (SELECT id FROM providerConnections WHERE ownerUsername = ?)`,
        [since, ownerUsername]
      );
      for (const r of rows) {
        const id = r.connectionId;
        const tok = parseJson(r.tokens, {}) || {};
        const cached = Number(tok.cached_tokens || tok.cache_read_input_tokens || 0);
        const prompt = Number(r.promptTokens || tok.prompt_tokens || tok.input_tokens || 0);
        const completion = Number(r.completionTokens || tok.completion_tokens || tok.output_tokens || 0);
        accountUsage[id] ||= { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
        accountUsage[id].requests += 1;
        accountUsage[id].promptTokens += prompt;
        accountUsage[id].completionTokens += completion;
        accountUsage[id].cachedTokens += cached;
        accountUsage[id].cost += Number(r.cost || 0);
      }
    } else {
      const bucketCount = period === "30d" ? 30 : period === "60d" ? 60 : 7;
      const dayRows = loadDaysInRange(db, bucketCount);
      for (const r of dayRows) {
        const day = parseJson(r.data, {});
        for (const [cId, s] of Object.entries(day.byAccount || {})) {
          if (ownerUsername && !ownConnectionIds.has(cId)) continue;
          if (!accountUsage[cId]) {
            accountUsage[cId] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
          }
          accountUsage[cId].requests += (s.requests || 0);
          accountUsage[cId].promptTokens += (s.promptTokens || 0);
          accountUsage[cId].completionTokens += (s.completionTokens || 0);
          accountUsage[cId].cachedTokens += (s.cachedTokens || 0);
          accountUsage[cId].cost += (s.cost || 0);
        }
      }
    }

    const accounts = connections.map((c) => {
      const u = accountUsage[c.id] || { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
      const prompt = u.promptTokens || 0;
      const cached = u.cachedTokens || 0;
      const hitRate = prompt > 0 ? Number(((cached / prompt) * 100).toFixed(1)) : 0;
      return {
        id: c.id,
        name: c.name || c.email || c.id,
        email: c.email || null,
        provider: c.provider,
        authType: c.authType,
        priority: c.priority ?? 1,
        isActive: Boolean(c.isActive),
        throttlePercent: c.throttlePercent ?? 0,
        weight: c.weight ?? null,
        dynamicBalanceEnabled: Boolean(c.dynamicBalanceEnabled),
        requests: u.requests,
        promptTokens: prompt,
        cachedTokens: cached,
        completionTokens: u.completionTokens,
        cost: Number(u.cost.toFixed(4)),
        hitRate,
      };
    }).sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.requests - a.requests;
    });

    const activeAccountsCount = accounts.filter((a) => a.isActive).length;

    let activeSessions = [];
    let allSessions = [];
    try {
      const { getSessionCacheSnapshot, hydrateSessionCacheFromDb } = await import("@/lib/jev/sessionCache.js");
      await hydrateSessionCacheFromDb().catch(() => {});
      const list = getSessionCacheSnapshot({ includeTurns: true })
        .map(({ cacheId, state, models, providers, cachedTokens, promptTokens, requests, cacheActive, lastActive, createdAt, turns }) => ({
          cacheId,
          state,
          models,
          providers: providers || [],
          provider: providers?.[0] || null,
          cacheActive,
          cachedTokens,
          promptTokens,
          requests,
          lastActive,
          createdAt: createdAt || lastActive,
          turns: turns || [],
        }))
        .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));

      const visibleSessions = ownerUsername
        ? list.filter((session) => session.connectionId && ownConnectionIds.has(session.connectionId))
        : list;
      allSessions = visibleSessions;
      activeSessions = visibleSessions.filter((s) => s.state === "active");
    } catch (sessionErr) {
      console.warn("[usageRepo] Failed to fetch session cache in getCockpitData:", sessionErr.message);
    }

    return {
      period,
      kpis: {
        jevDecisions: jevStats.requests,
        jevSuccessRate: jevStats.successRate,
        jevFallbacks: jevStats.fallbacks,
        jevAvgLatencyMs: jevStats.avgLatencyMs,
        cacheHitRate: cacheStats.summary.overallHitRate,
        totalCachedTokens: cacheStats.summary.totalCachedTokens,
        totalPromptTokens: cacheStats.summary.totalPromptTokens,
        totalRequests: cacheStats.summary.totalRequests,
        estimatedSavingsUsd: cacheStats.summary.estimatedSavingsUsd,
        activeAccountsCount,
        totalAccountsCount: accounts.length,
        activeSessionsCount: activeSessions.length,
        totalSessionsCount: allSessions.length,
      },
      sessions: {
        active: activeSessions,
        all: allSessions.slice(0, 30),
        activeCount: activeSessions.length,
        totalCount: allSessions.length,
      },
      jev: {
        requests: jevStats.requests,
        successRate: jevStats.successRate,
        fallbacks: jevStats.fallbacks,
        avgLatencyMs: jevStats.avgLatencyMs,
        topChoices: jevStats.topChoices,
        choices: jevStats.choices || {},
        callers: jevStats.callers,
        series: jevStats.series,
      },
      cache: {
        summary: cacheStats.summary,
        timeSeries: cacheStats.timeSeries,
        byProvider: ownerUsername
          ? cacheStats.byProvider.filter((provider) => connections.some((connection) => connection.provider === provider.provider))
          : cacheStats.byProvider,
      },
      accounts,
      recentRequests: (ownerUsername
        ? cacheStats.recentRequests.filter((request) => request.apiKeyOwner === ownerUsername || ownConnectionIds.has(request.connectionId))
        : cacheStats.recentRequests
      ).slice(0, 10),
    };
  } catch (e) {
    console.error("[usageRepo] getCockpitData failed:", e);
    return {
      period,
      kpis: { jevDecisions: 0, jevSuccessRate: 100, jevFallbacks: 0, jevAvgLatencyMs: 0, cacheHitRate: 0, totalCachedTokens: 0, totalPromptTokens: 0, totalRequests: 0, estimatedSavingsUsd: 0, activeAccountsCount: 0, totalAccountsCount: 0, activeSessionsCount: 0, totalSessionsCount: 0 },
      sessions: { active: [], all: [], activeCount: 0, totalCount: 0 },
      jev: { requests: 0, successRate: 100, fallbacks: 0, avgLatencyMs: 0, topChoices: [], callers: {}, series: [] },
      cache: { summary: {}, timeSeries: [], byProvider: [] },
      accounts: [],
      recentRequests: [],
    };
  }
}
