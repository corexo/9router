import { createHash } from "node:crypto";

/**
 * Remembers which model Jev last routed a conversation to, so the next turn can
 * be marked "Sticky: YES" (prompt-cache + style consistency).
 *
 * Clients send no session id, so the conversation is identified by a hash of its
 * opening messages — those stay byte-identical across turns of the same chat.
 *
 * Pinned on globalThis: Next.js bundles each route separately, so a module-scoped
 * Map would not be shared between the chat handler and other routes.
 */
const STORE_KEY = Symbol.for("9router.jevSessionModels");
const MAX_SESSIONS = 200;
const TTL_MS = 2 * 60 * 60 * 1000;

function store() {
  if (!globalThis[STORE_KEY]) globalThis[STORE_KEY] = new Map();
  return globalThis[STORE_KEY];
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text").map((part) => part.text || "").join("\n");
}

/** Stable id for a conversation, or null when there is nothing to key on. */
export function sessionKey(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) return null;
  // First two messages (usually system + first user turn) are stable for the
  // whole conversation; later turns only append.
  const seed = messages.slice(0, 2).map((message) => `${message?.role}:${textOf(message?.content)}`).join("\n");
  if (!seed.trim()) return null;
  return createHash("sha1").update(seed).digest("hex");
}

export function getSessionModel(key) {
  if (!key) return null;
  const entry = store().get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    store().delete(key);
    return null;
  }
  return entry.model;
}

export function setSessionModel(key, model) {
  if (!key || typeof model !== "string" || !model) return;
  const sessions = store();
  sessions.delete(key);
  sessions.set(key, { model, at: Date.now() });
  // Map preserves insertion order, so the oldest entry is the first key.
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
}

export function clearSessionModel(key) {
  if (!key) return;
  store().delete(key);
}

export function clearSessionModelByModel(model) {
  if (!model) return;
  const sessions = store();
  for (const [k, v] of sessions.entries()) {
    if (v.model === model) sessions.delete(k);
  }
}
