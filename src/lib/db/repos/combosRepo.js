import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownerUsername: row.ownerUsername || null,
  };
}

export async function getCombos(filter = {}) {
  const db = await getAdapter();
  const params = filter.ownerUsername ? [filter.ownerUsername] : [];
  const rows = db.all(`SELECT * FROM combos${params.length ? " WHERE ownerUsername = ?" : ""} ORDER BY createdAt ASC`, params);
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name, ownerUsername = null) {
  if (!name) return null;
  const db = await getAdapter();
  const row = ownerUsername
    ? db.get(`SELECT * FROM combos WHERE LOWER(name) = LOWER(?) AND ownerUsername = ?`, [name, ownerUsername])
    : db.get(`SELECT * FROM combos WHERE LOWER(name) = LOWER(?)`, [name]);
  return rowToCombo(row);
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    ownerUsername: data.ownerUsername ?? null,
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, ownerUsername, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.ownerUsername, combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, ownerUsername = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.ownerUsername ?? null, merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export const BUILTIN_COMBOS = ["jev"];

/**
 * Ensure built-in combos (e.g. the fixed `jev` Jev candidate pool) exist and are
 * flagged kind="builtin". Also migrates a user-created combo that already squat
 * on a built-in name. Called from GET /api/combos so the dashboard and routing
 * always see the fixed combo.
 */
export async function ensureBuiltinCombos() {
  const db = await getAdapter();
  for (const name of BUILTIN_COMBOS) {
    const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
    if (!row) {
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [uuidv4(), name, "builtin", stringifyJson([]), now, now]
      );
    } else if (row.kind !== "builtin") {
      db.run(`UPDATE combos SET kind = ?, updatedAt = ? WHERE id = ?`, [
        "builtin",
        new Date().toISOString(),
        row.id,
      ]);
    }
  }
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
