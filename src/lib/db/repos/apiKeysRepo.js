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
    lastUsed: row.lastUsed || null,
    requestsToday: Number(row.requestsToday || 0),
    totalRequests: Number(row.totalRequests || 0),
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`
    SELECT 
      k.id, k.key, k.name, k.machineId, k.isActive, k.createdAt,
      COALESCE(u.totalRequests, 0) as totalRequests,
      COALESCE(u.requestsToday, 0) as requestsToday,
      u.lastUsed
    FROM apiKeys k
    LEFT JOIN (
      SELECT 
        apiKey,
        COUNT(*) as totalRequests,
        MAX(timestamp) as lastUsed,
        SUM(CASE WHEN date(timestamp) = date('now') THEN 1 ELSE 0 END) as requestsToday
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
      k.id, k.key, k.name, k.machineId, k.isActive, k.createdAt,
      COALESCE(u.totalRequests, 0) as totalRequests,
      COALESCE(u.requestsToday, 0) as requestsToday,
      u.lastUsed
    FROM apiKeys k
    LEFT JOIN (
      SELECT 
        apiKey,
        COUNT(*) as totalRequests,
        MAX(timestamp) as lastUsed,
        SUM(CASE WHEN date(timestamp) = date('now') THEN 1 ELSE 0 END) as requestsToday
      FROM usageHistory
      WHERE apiKey IS NOT NULL
      GROUP BY apiKey
    ) u ON k.key = u.apiKey
    WHERE k.id = ?
  `, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId) {
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
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt]
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

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
