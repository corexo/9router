import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";

export async function getUserByUsername(username) {
  const db = await getAdapter();
  return db.get("SELECT * FROM users WHERE username = ?", [username]);
}

export async function listUsers() {
  const db = await getAdapter();
  return db.all("SELECT id, username, role, isActive, createdAt FROM users ORDER BY username COLLATE NOCASE");
}

export async function hasActiveUsers() {
  const db = await getAdapter();
  return !!db.get("SELECT 1 FROM users WHERE isActive = 1 LIMIT 1");
}

export async function hasUsers() {
  const db = await getAdapter();
  return !!db.get("SELECT 1 FROM users LIMIT 1");
}

export async function createUser(username, password, role = "moderator") {
  if (typeof username !== "string" || !username.trim() || typeof password !== "string" || !password || !["admin", "moderator"].includes(role)) {
    throw new Error("Invalid username, password or role");
  }
  const user = { id: randomUUID(), username: username.trim(), role, isActive: 1, createdAt: new Date().toISOString() };
  const hash = await bcrypt.hash(password, 10);
  const db = await getAdapter();
  db.run("INSERT INTO users (id, username, passwordHash, role, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
    [user.id, user.username, hash, role, 1, user.createdAt]);
  return user;
}

export async function verifyLogin(username, password) {
  if (typeof username !== "string" || typeof password !== "string") return null;
  const user = await getUserByUsername(username);
  if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) return null;
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

export async function setUserActive(id, active) {
  const db = await getAdapter();
  return (db.run("UPDATE users SET isActive = ? WHERE id = ?", [active ? 1 : 0, id])?.changes ?? 0) > 0;
}

export async function deleteUser(id) {
  const db = await getAdapter();
  return (db.run("DELETE FROM users WHERE id = ?", [id])?.changes ?? 0) > 0;
}

export async function setPasswordHash(id, hash) {
  const db = await getAdapter();
  return (db.run("UPDATE users SET passwordHash = ?, mustChangePassword = 0 WHERE id = ?", [hash, id])?.changes ?? 0) > 0;
}
