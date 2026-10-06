import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  const today = new Date().toISOString();
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt || today,
    ownerUsername: row.ownerUsername || null,
    lastUsedIp: row.lastUsedIp || null,
    lastUsedAt: row.lastUsedAt || null,
    lastUsed: row.lastUsed || null,
    requestsToday: Number(row.requestsToday || 0),
    totalRequests: Number(row.totalRequests || 0),
    totalPromptTokens: Number(row.totalPromptTokens || 0),
    totalCompletionTokens: Number(row.totalCompletionTokens || 0),
    totalCost: Number(row.totalCost || 0),
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`
    SELECT 
      k.id, k.key, k.name, k.machineId, k.isActive, k.createdAt, k.ownerUsername, k.lastUsedIp, k.lastUsedAt,
      COALESCE(u.totalRequests, 0) as totalRequests,
      COALESCE(u.requestsToday, 0) as requestsToday,
      COALESCE(u.totalPromptTokens, 0) as totalPromptTokens,
      COALESCE(u.totalCompletionTokens, 0) as totalCompletionTokens,
      COALESCE(u.totalCost, 0) as totalCost,
      u.lastUsed
    FROM apiKeys k
    LEFT JOIN (
      SELECT 
        apiKey,
        COUNT(*) as totalRequests,
        MAX(timestamp) as lastUsed,
        SUM(CASE WHEN date(timestamp) = date('now') THEN 1 ELSE 0 END) as requestsToday,
        SUM(COALESCE(promptTokens, 0)) as totalPromptTokens,
        SUM(COALESCE(completionTokens, 0)) as totalCompletionTokens,
        SUM(COALESCE(cost, 0)) as totalCost
      FROM usageHistory
      WHERE apiKey IS NOT NULL
      GROUP BY apiKey
    ) u ON k.key = u.apiKey
    ORDER BY k.createdAt ASC
  `);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`
    SELECT 
      k.id, k.key, k.name, k.machineId, k.isActive, k.createdAt, k.ownerUsername, k.lastUsedIp, k.lastUsedAt,
      COALESCE(u.totalRequests, 0) as totalRequests,
      COALESCE(u.requestsToday, 0) as requestsToday,
      COALESCE(u.totalPromptTokens, 0) as totalPromptTokens,
      COALESCE(u.totalCompletionTokens, 0) as totalCompletionTokens,
      COALESCE(u.totalCost, 0) as totalCost,
      u.lastUsed
    FROM apiKeys k
    LEFT JOIN (
      SELECT 
        apiKey,
        COUNT(*) as totalRequests,
        MAX(timestamp) as lastUsed,
        SUM(CASE WHEN date(timestamp) = date('now') THEN 1 ELSE 0 END) as requestsToday,
        SUM(COALESCE(promptTokens, 0)) as totalPromptTokens,
        SUM(COALESCE(completionTokens, 0)) as totalCompletionTokens,
        SUM(COALESCE(cost, 0)) as totalCost
      FROM usageHistory
      WHERE apiKey IS NOT NULL
      GROUP BY apiKey
    ) u ON k.key = u.apiKey
    WHERE k.id = ?
  `, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, ownerUsername = null) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    ownerUsername: ownerUsername || null,
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, ownerUsername) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, apiKey.ownerUsername]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKeyDetails(key, sourceIp = null) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  if (!row || !(row.isActive === 1 || row.isActive === true)) return null;
  if (sourceIp) {
    const lastUsedAt = new Date().toISOString();
    db.run("UPDATE apiKeys SET lastUsedIp = ?, lastUsedAt = ? WHERE id = ?", [sourceIp, lastUsedAt, row.id]);
    row.lastUsedIp = sourceIp;
    row.lastUsedAt = lastUsedAt;
  }
  return rowToKey(row);
}

export async function validateApiKey(key) {
  return !!(await validateApiKeyDetails(key));
}
