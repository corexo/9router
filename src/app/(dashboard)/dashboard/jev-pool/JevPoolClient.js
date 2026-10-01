"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, JevTierSlider } from "@/shared/components";

const PAID_PROVIDERS = new Set(["claude", "anthropic", "glm", "glm-cn", "zai", "codex", "chatgpt", "openai"]);
const TIERS = ["low", "fast", "mid", "strong", "frontier", "unknown"];
const fmt = (value) => new Intl.NumberFormat("de-DE").format(Number(value) || 0);

export default function JevPoolClient() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState([]);
  const [freeSelected, setFreeSelected] = useState([]);
  const [activeTab, setActiveTab] = useState("paid"); // "paid" | "free"
  const [tier, setTier] = useState("balanced");
  const [distributionEnabled, setDistributionEnabled] = useState(true);
  const [search, setSearch] = useState("");
  const [paidOnly, setPaidOnly] = useState(false);
  const [tierOverrides, setTierOverrides] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/jev/picker", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    const settingsResponse = await fetch("/api/settings", { cache: "no-store" });
    if (!settingsResponse.ok) throw new Error(`HTTP ${settingsResponse.status}`);
    const settings = await settingsResponse.json();
    setData(result);
    setTier(settings.jevTierPreference || "balanced");
    setDistributionEnabled(settings.jevTierDistributionEnabled !== false);
    setTierOverrides(settings.jevModelTiers || {});
    setSelected(Array.isArray(settings.jevPoolModels)
      ? settings.jevPoolModels
      : result.models.filter((model) => !model.excludedBy.length).map((model) => model.id));
    // Free pool: use explicit jevFreePoolModels if set, else pre-select all non-paid active models
    setFreeSelected(Array.isArray(settings.jevFreePoolModels)
      ? settings.jevFreePoolModels
      : result.models.filter((model) => !PAID_PROVIDERS.has(model.provider) && !model.excludedBy.length).map((model) => model.id));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => load().catch((error) => setMessage(`Laden fehlgeschlagen: ${error.message}`)), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const allModels = data?.models || [];
  const visible = useMemo(() => allModels.filter((model) =>
    (!paidOnly || PAID_PROVIDERS.has(model.provider)) &&
    `${model.id} ${model.provider}`.toLowerCase().includes(search.toLowerCase())), [allModels, paidOnly, search]);
  const freeVisible = useMemo(() => allModels.filter((model) =>
    !PAID_PROVIDERS.has(model.provider) &&
    `${model.id} ${model.provider}`.toLowerCase().includes(search.toLowerCase())), [allModels, search]);
  const providerStats = useMemo(() => {
    const stats = data?.usage?.byProvider || {};
    return [...["claude", "glm", "codex"]].map((provider) => ({ provider, ...(stats[provider] || {}) }));
  }, [data]);

  const save = async () => {
    if (activeTab === "paid" && selected.length === 0) { setMessage("Mindestens ein Modell im Jev-Pool auswählen."); return; }
    if (activeTab === "free" && freeSelected.length === 0) { setMessage("Mindestens ein Modell im Free-Pool auswählen."); return; }
    setBusy(true); setMessage("");
    try {
      const body = activeTab === "free"
        ? { jevFreePoolModels: freeSelected }
        : { jevPoolModels: selected, jevTierPreference: tier, jevTierDistributionEnabled: distributionEnabled, jevModelTiers: tierOverrides };
      const response = await fetch("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setMessage("Einstellungen gespeichert.");
      await load();
    } catch (error) { setMessage(`Speichern fehlgeschlagen: ${error.message}`); }
    finally { setBusy(false); }
  };

  const exportTiers = () => {
    const blob = new Blob([JSON.stringify(tierOverrides, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "jev-model-tiers.json"; link.click(); URL.revokeObjectURL(url);
  };
  const importTiers = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const value = parsed.modelTiers ?? parsed;
      const valid = new Set(TIERS.slice(0, -1));
      if (!value || Array.isArray(value) || typeof value !== "object" || Object.entries(value).some(([id, tierValue]) => !id.includes("/") || !valid.has(tierValue))) throw new Error("JSON muss Modell-IDs auf low/fast/mid/strong/frontier abbilden.");
      setTierOverrides(value);
      setMessage(`${Object.keys(value).length} Tier-Zuordnungen importiert. Speichern nicht vergessen.`);
    } catch (error) { setMessage(`JSON-Import fehlgeschlagen: ${error.message}`); }
    event.target.value = "";
  };
  const assignTier = (id, value) => setTierOverrides((current) => {
    const next = { ...current };
    if (value === "unknown") delete next[id];
    else next[id] = value;
    return next;
  });
  const setVisible = (checked) => setSelected((current) => {
    const visibleIds = new Set(visible.map((model) => model.id));
    return checked ? [...new Set([...current, ...visibleIds])] : current.filter((id) => !visibleIds.has(id));
  });
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleFree = (id) => setFreeSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const setFreeVisible = (checked) => setFreeSelected((current) => {
    const visibleIds = new Set(freeVisible.map((model) => model.id));
    return checked ? [...new Set([...current, ...visibleIds])] : current.filter((id) => !visibleIds.has(id));
  });

  return <main className="mx-auto max-w-7xl space-y-6 p-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><Link className="text-sm text-blue-400" href="/dashboard/jev-inspector">Jev Inspector</Link><h1 className="mt-2 text-2xl font-semibold">Jev Modell-Pool</h1><p className="text-sm text-zinc-400">Konfiguriere Paid Pool (jev / jev-1m) und Free Pool (jev-free) getrennt.</p></div>
      <Button onClick={save} disabled={busy}>{busy ? "Speichert…" : "Speichern"}</Button>
    </header>
    {/* Tab nav */}
    <div className="flex gap-2 border-b border-zinc-700">
      <button onClick={() => setActiveTab("paid")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "paid" ? "border-blue-500 text-blue-400" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}>Paid Pool <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-xs">{selected.length}</span></button>
      <button onClick={() => setActiveTab("free")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "free" ? "border-emerald-500 text-emerald-400" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}>Free Pool <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-xs">{freeSelected.length}</span></button>
    </div>

    {activeTab === "paid" && <>
      <p className="text-xs text-zinc-500">Pool-Modus: {data?.sources?.poolMode || "Lädt…"}</p>
      <Card className="space-y-3 p-4"><label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={distributionEnabled} onChange={(event) => setDistributionEnabled(event.target.checked)} />Tier-Verteilung verwenden</label>{distributionEnabled && <><h2 className="font-medium">Tendenz</h2><JevTierSlider value={tier} onChange={setTier} /><p className="text-xs text-zinc-400">Die Tendenz sortiert nicht aus: Jeder aktivierte Pool-Kandidat bleibt auswählbar.</p></>}<p className="text-xs text-zinc-400">Deaktiviert: keine Tier-Einstufung für Jev. Jev erhält ausschließlich angehakte Pool-Modelle.</p></Card>
      <section className="grid gap-3 md:grid-cols-3">{providerStats.map((stat) => <Card key={stat.provider} className="p-4"><div className="flex justify-between"><h2 className="font-semibold">{stat.provider}</h2><Badge variant="outline">Paid</Badge></div><p className="mt-2 text-sm text-zinc-400">{fmt(stat.requests)} Requests · {fmt((stat.promptTokens || 0) + (stat.completionTokens || 0))} Tokens</p></Card>)}</section>
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3"><label className="cursor-pointer rounded border border-zinc-700 px-3 py-2 text-sm">JSON importieren<input type="file" accept="application/json,.json" className="sr-only" onChange={importTiers} /></label><Button variant="outline" onClick={exportTiers}>Tier-JSON exportieren</Button><span className="text-xs text-zinc-500">Importformat: {`{"provider/model":"low|fast|mid|strong|frontier"}`}</span></div>
        <div className="flex flex-wrap items-center gap-3"><input aria-label="Modelle suchen" className="min-w-56 rounded border border-zinc-700 bg-transparent px-3 py-2" placeholder="Modell suchen" value={search} onChange={(event) => setSearch(event.target.value)} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paidOnly} onChange={(event) => setPaidOnly(event.target.checked)} />Nur Paid (Claude, GLM, Codex)</label><Button variant="outline" onClick={() => setVisible(true)}>Alle sichtbar</Button><Button variant="outline" onClick={() => setVisible(false)}>Keine sichtbar</Button><span className="ml-auto text-sm text-zinc-400">Ausgewählt: {selected.length} · angezeigt: {visible.length}</span></div>
        <p className="text-xs text-zinc-400">Modelle zwischen Spalten ziehen oder über „Verschieben nach" zuordnen. Änderungen mit Speichern übernehmen.</p>
        <div className="grid gap-3 lg:grid-cols-3 2xl:grid-cols-6">{TIERS.map((column) => {
          const models = visible.filter((model) => (tierOverrides[model.id] || model.tier || "unknown") === column);
          return <section key={column} aria-label={`Tier ${column}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (data?.models.some((model) => model.id === id)) assignTier(id, column); }} className="min-h-32 rounded-lg border border-zinc-700 bg-zinc-900/40 p-3">
            <h3 className="mb-3 font-semibold capitalize">{column === "unknown" ? "Unbekannt" : column} <span className="text-xs text-zinc-400">({models.length})</span></h3>
            <div className="space-y-2">{models.map((model) => <article key={model.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", model.id)} className="rounded border border-zinc-700 bg-zinc-900 p-2 text-xs">
              <div className="flex items-start gap-2"><input type="checkbox" aria-label={`Modell ${model.id} auswählen`} checked={selected.includes(model.id)} onChange={() => toggle(model.id)} /><span className="break-all font-mono">{model.id}</span></div>
              <p className="mt-2 text-zinc-400">{model.contextWindow ? `${fmt(model.contextWindow)} Tokens` : "—"} · {model.vision ? "Vision" : "Text"} · {PAID_PROVIDERS.has(model.provider) ? "Paid" : "Free/Flat"} · {model.health}{model.excludedBy.length ? ` · ${model.excludedBy.join(", ")}` : ""}</p>
              <select aria-label={`Tier für ${model.id}`} className="mt-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1" value={column} onChange={(event) => assignTier(model.id, event.target.value)}>{TIERS.map((option) => <option key={option} value={option}>Verschieben nach {option === "unknown" ? "Unbekannt" : option}</option>)}</select>
            </article>)}</div>
          </section>;
        })}</div>
      </Card>
    </>}

    {activeTab === "free" && <>
      <p className="text-xs text-zinc-500">Free-Pool-Modus: {data?.sources?.freePoolMode || "Lädt…"} · Für <code className="rounded bg-zinc-800 px-1">jev-free</code> / Subagent-Tasks</p>
      <Card className="p-4 space-y-3">
        <p className="text-sm text-zinc-400">Nur Free/Flat-Rate Modelle (ohne Paid-Provider). Kein Caching, kein Sticky. Für Subagents und kurze Neben-Tasks.</p>
        <div className="flex flex-wrap items-center gap-3"><input aria-label="Modelle suchen" className="min-w-56 rounded border border-zinc-700 bg-transparent px-3 py-2" placeholder="Modell suchen" value={search} onChange={(event) => setSearch(event.target.value)} /><Button variant="outline" onClick={() => setFreeVisible(true)}>Alle aktivieren</Button><Button variant="outline" onClick={() => setFreeVisible(false)}>Alle deaktivieren</Button><span className="ml-auto text-sm text-zinc-400">Ausgewählt: {freeSelected.length} · angezeigt: {freeVisible.length}</span></div>
        <div className="space-y-2">{freeVisible.map((model) => <article key={model.id} className="flex items-center gap-3 rounded border border-zinc-700 bg-zinc-900 p-2 text-xs">
          <input type="checkbox" aria-label={`Free-Modell ${model.id} auswählen`} checked={freeSelected.includes(model.id)} onChange={() => toggleFree(model.id)} />
          <span className="break-all font-mono flex-1">{model.id}</span>
          <span className="text-zinc-400">{model.contextWindow ? `${fmt(model.contextWindow)}k` : "—"} · {model.tier || "?"} · {model.health}</span>
        </article>)}{freeVisible.length === 0 && <p className="text-sm text-zinc-500">Keine Free/Flat-Rate Modelle aktiv konfiguriert.</p>}</div>
      </Card>
    </>}

    {message && <p role="status" className="text-sm">{message}</p>}
  </main>;
}
