/**
 * Session-Sticky Cache Pinning
 * 
 * When prompt caching is active (static system + tools),
 * pin the same provider for the entire session to maximize cache hits.
 * Only switch on real errors (429/500), not on soft fallback.
 */

import crypto from "crypto";

const sessionPins = new Map(); // sessionId -> { model, pinnedAt, hitCount }

function getSessionId(body, credentials) {
  // Derive stable session ID from: user context + model + first message hash
  const first = (body.messages || [])[0];
  const seed = [
    credentials?.connectionId || "anon",
    body.model || "unknown",
    first?.content ? typeof first.content === "string" ? first.content.slice(0, 50) : JSON.stringify(first.content).slice(0, 50) : ""
  ].join("|");
  
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

export function getStickyModel(body, credentials, comboModels) {
  if (!comboModels || comboModels.length <= 1) return null;
  
  const sessionId = getSessionId(body, credentials);
  const pin = sessionPins.get(sessionId);
  
  if (pin && comboModels.includes(pin.model)) {
    pin.hitCount++;
    return pin.model; // Sticky: return pinned model
  }
  
  return null; // No sticky pin active
}

export function setStickyPin(body, credentials, model, comboModels) {
  if (!comboModels || comboModels.length <= 1) return;
  
  const sessionId = getSessionId(body, credentials);
  const pin = sessionPins.get(sessionId);
  
  // Only pin first successful request, or refresh on cache-aware operation
  if (!pin || pin.model !== model) {
    sessionPins.set(sessionId, {
      model,
      pinnedAt: Date.now(),
      hitCount: 1
    });
  }
}

export function clearStickyPin(body, credentials) {
  const sessionId = getSessionId(body, credentials);
  sessionPins.delete(sessionId);
}

export function getCacheStats() {
  return {
    activeSessions: sessionPins.size,
    pins: Array.from(sessionPins.entries()).map(([id, pin]) => ({
      sessionId: id,
      model: pin.model,
      hits: pin.hitCount,
      age: Date.now() - pin.pinnedAt
    }))
  };
}

// Cleanup stale pins (>1h old)
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, pin] of sessionPins.entries()) {
    if (now - pin.pinnedAt > 3600000) {
      sessionPins.delete(id);
    }
  }
}, 600000); // Check every 10 min
cleanupTimer?.unref?.();
