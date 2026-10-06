"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Card } from "@/shared/components";
import { usePersistentState } from "@/shared/hooks";

// The 4 stages of one request, in flow order.
const STAGES = [
	{ id: "incoming", label: "① Request von Pi", color: "text-sky-400" },
	{ id: "fullPayload", label: "② Request an Jev", color: "text-violet-400", json: true },
	{ id: "jevResponse", label: "③ Antwort von Jev", nested: "rawText", color: "text-amber-400" },
	{ id: "outgoing", label: "④ Response an Pi", nested: "preview", color: "text-emerald-400" },
];

function pretty(text) {
	if (text == null) return "";
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

function formatBytes(bytes) {
	if (!bytes && bytes !== 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}

function stageBody(entry, stage) {
	const data = entry[stage.id];
	if (!data) return null;
	let text;
	if (stage.nested) {
		text = data[stage.nested];
	} else if (stage.json) {
		text = pretty(typeof data === "string" ? data : JSON.stringify(data));
	} else {
		text = data.text ?? JSON.stringify(data, null, 2);
	}
	if (!text) return null;
	return { text, bytes: data.bytes, truncated: data.truncated };
}

function StageSection({ entry, stage }) {
	const [copied, setCopied] = useState(false);
	const body = stageBody(entry, stage);
	if (!body) return null;

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(body.text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch { /* clipboard unavailable */ }
	};

	const meta = [];
	if (stage.id === "jevResponse" && entry.jevResponse?.httpStatus) meta.push(`HTTP ${entry.jevResponse.httpStatus}`);
	if (stage.id === "outgoing" && entry.outgoing?.status) meta.push(`HTTP ${entry.outgoing.status}`);
	if (body.bytes != null) meta.push(formatBytes(body.bytes));

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
			<div className="mb-2 flex items-center justify-between gap-2">
				<span className={`text-sm font-medium ${stage.color}`}>{stage.label}</span>
				<div className="flex items-center gap-2">
					<span className="text-xs text-zinc-500">
						{meta.join(" · ")}
						{body.truncated && <span className="ml-1 text-yellow-500">(gekürzt)</span>}
					</span>
					<button
						onClick={copy}
						className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					>
						{copied ? "Kopiert" : "Kopieren"}
					</button>
				</div>
			</div>
			<pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2 text-xs text-zinc-300">
				{body.text || "(leer)"}
			</pre>
		</div>
	);
}

function statusOf(entry) {
	if (entry.error) return { label: "Fehler", cls: "bg-red-500/15 text-red-400" };
	if (entry.invalid) return { label: "Ungültig", cls: "bg-orange-500/15 text-orange-400" };
	if (entry.cached) return { label: "Cache", cls: "bg-blue-500/15 text-blue-400" };
	if (entry.selectedModel) return { label: "OK", cls: "bg-emerald-500/15 text-emerald-400" };
	return { label: "Läuft…", cls: "bg-zinc-500/15 text-zinc-400" };
}

function timeOf(entry) {
	try {
		return new Date(entry.timestamp).toLocaleTimeString("de-DE");
	} catch {
		return entry.timestamp;
	}
}

// ---------------------------------------------------------------------------
function parseStage(value) {
	if (!value) return null;
	try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return null; }
}

function LiveMapTab({ log }) {
	const questions = new Map();
	for (const entry of [...log].reverse()) {
		const payload = parseStage(entry.fullPayload);
		const response = parseStage(entry.jevResponse?.rawText);
		const answered = response?.answers?.["model-selection"] ?? response?.answers?.model ?? Object.values(response?.answers || {})[0];
		const selected = answered?.choice ?? entry.selectedModel;
		for (const [id, item] of Object.entries(payload?.questions || {})) {
			const choices = Object.keys(item.criteria || {});
			if (!questions.has(id)) questions.set(id, { id, prompt: item.instructions || id, choices, selected, count: 1 });
			else if (entry.selectedModel || selected) questions.get(id).selected = selected || entry.selectedModel;
			else questions.get(id).count++;
		}
	}
	const nodes = [...questions.values()].slice(0, 18);
	const width = 900, height = 520, center = { x: width / 2, y: height / 2 };
	return (
		<Card className="overflow-hidden p-4" aria-label="Jev request live map">
			<div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-medium text-text-primary">Jev Live Map</h2><p className="text-sm text-text-muted">Fragen und Kandidaten aus den letzten Jev-Traces</p></div><span className="text-xs text-text-muted">{nodes.length} Fragen · {log.length} Traces</span></div>
			{nodes.length ? <div className="max-h-[70vh] overflow-auto rounded-xl border border-border-subtle bg-bg"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Jev zentral, Fragen und Modellauswahl als verbundene Knoten" className="min-h-[360px] min-w-[620px] w-full">
				{nodes.map((node, index) => {
					const angle = index / nodes.length * Math.PI * 2 - Math.PI / 2;
					const point = { x: center.x + Math.cos(angle) * 320, y: center.y + Math.sin(angle) * 195 };
					return <g key={node.id}><path d={`M ${center.x} ${center.y} Q ${(center.x + point.x) / 2} ${(center.y + point.y) / 2 - 25} ${point.x} ${point.y}`} fill="none" stroke="currentColor" strokeOpacity=".24"/>
						<foreignObject x={point.x - 86} y={point.y - 38} width="172" height="90"><div xmlns="http://www.w3.org/1999/xhtml" className="rounded-lg border border-border-subtle bg-surface p-2 text-center shadow-sm"><p className="line-clamp-2 text-xs text-text-primary" title={node.prompt}>{node.prompt}</p><p className="mt-1 truncate font-mono text-[10px] text-primary" title={node.selected || "Keine Antwort aufgezeichnet"}>{node.selected || `${node.count} Anfrage${node.count === 1 ? "" : "n"}`}</p></div></foreignObject>
						{node.choices.slice(0, 4).map((choice, choiceIndex) => {
							const fraction = .52 + choiceIndex * .07;
							return <g key={choice}><path d={`M ${point.x} ${point.y} L ${point.x + (center.x - point.x) * fraction} ${point.y + (center.y - point.y) * fraction}`} stroke="currentColor" strokeOpacity={choice === node.selected ? ".65" : ".12"}/><text x={point.x + (center.x - point.x) * fraction} y={point.y + (center.y - point.y) * fraction} className={choice === node.selected ? "fill-primary" : "fill-text-muted"} fontSize="9" textAnchor="middle">{choice.slice(0, 22)}</text></g>;
						})}
					</g>;
				})}
				<circle cx={center.x} cy={center.y} r="40" className="fill-primary"/><text x={center.x} y={center.y + 5} textAnchor="middle" className="fill-white" fontSize="17" fontWeight="600">Jev</text>
			</svg></div> : <p className="py-16 text-center text-sm text-text-muted">Noch keine vollständigen Jev-Traces. Requests über Modell-Alias <code>jev</code> werden hier als Karte angezeigt.</p>}
		</Card>
	);
}

function ModelPickerTab() {
	const [data, setData] = useState(null);
	const [tokens, setTokens] = useState(0);
	const [vision, setVision] = useState(false);
	const [bigContext, setBigContext] = useState(false);

	const load = useCallback(async () => {
		const params = new URLSearchParams({ tokens: String(tokens), vision: String(vision), bigContext: String(bigContext) });
		const response = await fetch(`/api/jev/picker?${params}`);
		if (response.ok) setData(await response.json());
	}, [tokens, vision, bigContext]);

	useEffect(() => {
		const initial = setTimeout(load, 0);
		return () => clearTimeout(initial);
	}, [load]);
	if (!data) return <Card className="p-6 text-sm text-zinc-400">Model Picker wird geladen…</Card>;
	const eligible = data.models.filter((model) => model.excludedBy.length === 0);
	return (
		<div className="space-y-4">
			<Card className="p-4">
				<div className="flex flex-wrap items-end gap-4">
					<label className="grid gap-1 text-xs text-zinc-400">Geschätzte Input-Tokens<input type="number" min="0" value={tokens} onChange={(event) => setTokens(event.target.value)} className="w-40 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100" /></label>
					<label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={vision} onChange={(event) => setVision(event.target.checked)} /> Bild-Request</label>
					<label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={bigContext} onChange={(event) => setBigContext(event.target.checked)} /> Jev-1m</label>
					<Button variant="secondary" onClick={load}>Aktualisieren</Button>
				</div>
			</Card>
			<div className="grid gap-4 lg:grid-cols-3">
				<Card className="p-4 lg:col-span-2"><p className="text-xs uppercase tracking-wider text-zinc-500">Aktueller Pool</p><p className="mt-2 text-3xl font-semibold text-zinc-100">{eligible.length} Modelle</p><p className="mt-1 text-sm text-zinc-400">Quelle: {data.sources.comboMode}</p></Card>
				<Card className="p-4 text-sm text-zinc-300"><p className="text-xs uppercase tracking-wider text-zinc-500">Regeln</p><p className="mt-2">Tier-Präferenz: {data.settings.tierPreference} (soft bias, keine Modelle entfernt)</p><p>Lokale Modelle: {data.settings.excludeLocalModels ? "ausgeschlossen" : "erlaubt"}</p><p>Jev-Cache: {data.settings.cacheTtlMs} ms</p></Card>
			</div>
			<Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-zinc-800 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">Modell</th><th className="px-4 py-3">Einflussfaktoren</th><th className="px-4 py-3">Accounts</th><th className="px-4 py-3">Ergebnis</th></tr></thead><tbody>{data.models.map((model) => <tr key={model.id} className="border-b border-zinc-800/60"><td className="px-4 py-3 font-mono text-xs text-zinc-200">{model.id}<div className="mt-1 font-sans text-zinc-500">{model.tier} · {model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k Context` : "Context unbekannt"} · {model.vision ? "Vision" : "kein Vision"}</div></td><td className="px-4 py-3 text-xs text-zinc-400">Status: {model.health}{model.pricing ? ` · $${model.pricing.input.toFixed(2)}/1M Input` : " · Flat-rate"}</td><td className="px-4 py-3 text-xs text-zinc-400">{model.account.active} aktiv · {model.account.locked} gesperrt</td><td className={`px-4 py-3 text-xs ${model.excludedBy.length ? "text-amber-400" : "text-emerald-400"}`}>{model.excludedBy.length ? model.excludedBy.join(" · ") : "An Jev gesendet"}</td></tr>)}</tbody></table></div></Card>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function JevInspectorClient() {
	const [activePrimaryTab, setActivePrimaryTab] = usePersistentState("9router_jev_inspector_tab", "inspector");
	const [log, setLog] = useState([]);
	const [manualExpandedId, setExpandedId] = useState(null); // null = auto (neuester Eintrag bei Stage-Filter)
	const [auto, setAuto] = usePersistentState("9router_jev_inspector_auto", true);
	const searchParams = useSearchParams();
	const stageFilter = STAGES.some((s) => s.id === searchParams.get("stage")) ? searchParams.get("stage") : null;
	const visibleStages = stageFilter ? STAGES.filter((s) => s.id === stageFilter) : STAGES;
	const filteredStage = STAGES.find((s) => s.id === stageFilter);
	// Sidebar stage links land with ?stage=…: auto-open the newest request, narrowed to that stage.
	const expandedId = manualExpandedId ?? (stageFilter ? log[0]?.id : null);

	const fetchLog = useCallback(async () => {
		try {
			const res = await fetch("/api/debug/jev");
			if (res.ok) {
				const data = await res.json();
				setLog(data.log || []);
			}
		} catch { /* server unreachable — keep last state */ }
	}, []);

	useEffect(() => {
		const initial = setTimeout(fetchLog, 0);
		if (!auto) return () => clearTimeout(initial);
		const timer = setInterval(fetchLog, 3000);
		return () => {
			clearTimeout(initial);
			clearInterval(timer);
		};
	}, [auto, fetchLog]);

	const clearLog = async () => {
		try {
			await fetch("/api/debug/jev", { method: "DELETE" });
			setLog([]);
			setExpandedId(null);
		} catch { /* ignore */ }
	};

	return (
		<div className="space-y-4 p-6">
			{/* Primary tab switcher: Jev Inspector ↔ Live Map */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/60 p-1">
					<button
						type="button"
						onClick={() => setActivePrimaryTab("inspector")}
						className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
							activePrimaryTab === "inspector"
								? "bg-zinc-700 text-zinc-100 shadow-sm"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						<span className="material-symbols-outlined text-[14px]">manage_search</span>
						Jev Inspector
					</button>
					<button
						type="button"
						onClick={() => setActivePrimaryTab("picker")}
						className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
							activePrimaryTab === "picker" ? "bg-violet-600/20 text-violet-300 shadow-sm border border-violet-500/30" : "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						<span className="material-symbols-outlined text-[14px]">account_tree</span>
						Model Picker
					</button>
					<button
						type="button"
						onClick={() => setActivePrimaryTab("livemap")}
						className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
							activePrimaryTab === "livemap"
								? "bg-teal-600/20 text-teal-300 shadow-sm border border-teal-500/30"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						<span className="material-symbols-outlined text-[14px]">conversion_path</span>
						Live Map
					</button>
				</div>

				{/* Inspector-only controls */}
				{activePrimaryTab === "inspector" && (
					<div className="flex items-center gap-2">
						<Button variant={auto ? "primary" : "secondary"} onClick={() => setAuto((v) => !v)}>
							{auto ? "Auto-Refresh an" : "Auto-Refresh aus"}
						</Button>
						<Button variant="secondary" onClick={fetchLog}>Aktualisieren</Button>
						<Button variant="danger" onClick={clearLog}>Leeren</Button>
					</div>
				)}
			</div>

			{/* Inspector sub-header — only shown when a stage filter is active */}
			{activePrimaryTab === "inspector" && filteredStage && (
				<p className="text-sm text-zinc-500">
					Filter: <span className="text-zinc-300">{filteredStage.label}</span>
					{" · "}
					<Link href="/dashboard/jev-inspector" className="underline hover:text-zinc-300">Alle Stufen zeigen</Link>
				</p>
			)}

			{/* Model Picker tab */}
			{activePrimaryTab === "picker" && <ModelPickerTab />}

			{/* Live Map tab */}
			{activePrimaryTab === "livemap" && <LiveMapTab log={log} />}

			{/* Inspector tab — request log table */}
			{activePrimaryTab === "inspector" && (
				<Card className="overflow-hidden">
					<div className="overflow-x-auto">
						<table className="w-full text-left text-sm">
							<thead className="border-b border-zinc-800 text-xs uppercase text-zinc-500">
								<tr>
									<th className="px-4 py-3">Zeit</th>
									<th className="px-4 py-3">Gewählt</th>
									<th className="px-4 py-3">Status</th>
									<th className="px-4 py-3">Kandidaten</th>
									<th className="px-4 py-3">Latenz</th>
									<th className="px-4 py-3">Stufen</th>
								</tr>
							</thead>
							<tbody>
								{log.length === 0 && (
									<tr>
										<td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
											Noch keine Jev-Requests. Model-Alias &quot;jev&quot; verwenden, dann erscheinen hier Requests.
										</td>
									</tr>
								)}
								{log.map((entry) => {
									const status = statusOf(entry);
									const stages = [entry.incoming, entry.fullPayload, entry.jevResponse, entry.outgoing].filter(Boolean).length;
									const expanded = expandedId === entry.id;
									return (
										<Fragment key={entry.id}>
											<tr
												onClick={() => setExpandedId(expanded ? null : entry.id)}
												className={`cursor-pointer border-b border-zinc-800/60 hover:bg-zinc-800/40 ${expanded ? "bg-zinc-800/60" : ""}`}
											>
												<td className="px-4 py-2.5 font-mono text-xs text-zinc-400">{timeOf(entry)}</td>
												<td className="px-4 py-2.5 font-mono text-xs text-zinc-200">
													{entry.selectedModel || entry.cachedModel || "—"}
													{entry.fallbackUsed ? <span className="ml-1 text-yellow-500" title={`Fallback: ${entry.fallbackReason}`}>⤸</span> : null}
												</td>
												<td className="px-4 py-2.5">
													<span className={`rounded px-2 py-0.5 text-xs ${status.cls}`}>{status.label}</span>
												</td>
												<td className="px-4 py-2.5 text-zinc-400">{entry.numModels ?? "—"}</td>
												<td className="px-4 py-2.5 text-zinc-400">{entry.latencyMs != null ? `${entry.latencyMs} ms` : "—"}</td>
												<td className="px-4 py-2.5 text-zinc-500">{stages}/4</td>
											</tr>
											{expanded && (
												<tr className="border-b border-zinc-800/60 bg-zinc-900/40">
													<td colSpan={6} className="p-4">
														<div className={filteredStage ? "flex flex-col gap-3" : "grid gap-3 lg:grid-cols-2"}>
															{visibleStages.map((stage) => (
																<StageSection key={stage.id} entry={entry} stage={stage} />
															))}
														</div>
														{entry.error && (
															<p className="mt-3 text-xs text-red-400">Fehler: {entry.error}</p>
														)}
														{entry.fallbackReason && (
															<p className="mt-1 text-xs text-yellow-500">Fallback: {entry.fallbackUsed} — {entry.fallbackReason}</p>
														)}
													</td>
												</tr>
											)}
										</Fragment>
									);
								})}
							</tbody>
						</table>
					</div>
				</Card>
			)}
		</div>
	);
}
