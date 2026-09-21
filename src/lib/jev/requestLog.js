/**
 * In-memory log of recent Jev requests for debugging.
 * Stores last N requests with their criteria to show in dashboard.
 *
 * Next.js bundles each route separately, so a plain module-level array would
 * give the chat handler and the /api/debug/jev route two distinct instances.
 * Pinning the store on globalThis keeps a single shared log across bundles.
 */

const MAX_REQUESTS = 50;
const STORE = Symbol.for("9router.jevRequestLog");

function store() {
  if (!globalThis[STORE]) globalThis[STORE] = [];
  return globalThis[STORE];
}

export function logJevRequest(payload, numModels) {
  const log = store();
  log.unshift({
    timestamp: new Date().toISOString(),
    numModels,
    ...payload,
  });
  if (log.length > MAX_REQUESTS) log.length = MAX_REQUESTS;
}

export function updateLastJevRequest(result) {
  const log = store();
  if (log.length > 0) Object.assign(log[0], result);
}

export function getJevRequestLog() {
  return store();
}

export function clearJevRequestLog() {
  store().length = 0;
}
