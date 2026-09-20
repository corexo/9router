/**
 * In-memory log of recent Jev requests for debugging.
 * Stores last N requests with their criteria to show in dashboard.
 */

const MAX_REQUESTS = 50;
let requestLog = [];

export function logJevRequest(payload, numModels) {
  requestLog.unshift({
    timestamp: new Date().toISOString(),
    numModels,
    ...payload,
  });
  if (requestLog.length > MAX_REQUESTS) {
    requestLog = requestLog.slice(0, MAX_REQUESTS);
  }
}

export function getJevRequestLog() {
  return requestLog;
}

export function clearJevRequestLog() {
  requestLog = [];
}
