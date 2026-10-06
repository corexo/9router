import { getAdapter } from "../driver.js";

const RETENTION_DAYS = 90;

export async function listLoginAudit({ username = null, limit = 100 } = {}) {
  const db = await getAdapter();
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 100));
  return username
    ? db.all("SELECT username, sourceIp, success, userAgent, createdAt FROM authLoginAudit WHERE username = ? ORDER BY id DESC LIMIT ?", [username, safeLimit])
    : db.all("SELECT username, sourceIp, success, userAgent, createdAt FROM authLoginAudit ORDER BY id DESC LIMIT ?", [safeLimit]);
}

export async function recordLoginAttempt({ username = null, sourceIp = "unknown", success = false, userAgent = null } = {}) {
  const db = await getAdapter();
  const createdAt = new Date().toISOString();
  db.run(
    "INSERT INTO authLoginAudit(username, sourceIp, success, userAgent, createdAt) VALUES (?, ?, ?, ?, ?)",
    [username, sourceIp, success ? 1 : 0, userAgent, createdAt]
  );
  db.run("DELETE FROM authLoginAudit WHERE createdAt < ?", [new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()]);
}
