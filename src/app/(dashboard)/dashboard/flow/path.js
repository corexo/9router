// Request → Mesh-Pfad: reine Funktion, unabhängig von React (testbar in vitest).
export function buildPath(d) {
  const p = ["http", "gateway", "auth"];
  if (d.status === "error" && (d.code === 401 || d.code === 403)) {
    p.push("error");
    return p;
  }
  if (d.cached) {
    p.push("cache");
  }
  p.push("engine");
  if (d.status === "error") {
    p.push("error");
    return p;
  }
  p.push("ai");
  p.push(d.stream ? "stream" : "ok");
  return p;
}

export function pathColor(d) {
  if (d.status === "error") return "#f43f5e";
  if (d.stream) return "#f59e0b";
  if (d.cached) return "#10b981";
  return "#06b6d4";
}

