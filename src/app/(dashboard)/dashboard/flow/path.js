// Request → Mesh-Pfad: reine Funktion, unabhängig von React (testbar in vitest).
export function buildPath(d) {
  const p = ["http", "gateway", "auth", "engine"];
  if (d.status === "error") { p.push("error"); return p; }
  if (d.cached) p.push("cache");
  p.push("ai");
  p.push(d.stream ? "stream" : "ok");
  return p;
}

export function pathColor(d) {
  if (d.status === "error") return "#fb7185";
  if (d.stream) return "#fbbf24";
  if (d.cached) return "#34d399";
  return "#60a5fa";
}
