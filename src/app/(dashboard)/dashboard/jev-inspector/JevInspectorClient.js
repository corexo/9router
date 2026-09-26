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

export default function JevInspectorClient() {
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
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold text-zinc-100">Jev Inspector</h1>
					<p className="text-sm text-zinc-500">
						Anfrage-Flow pro Request: ① Pi → ② Jev → ③ Jev-Antwort → ④ Response an Pi. Zeile anklicken für Details.
						{filteredStage && (
							<>
								{" "}
								· Filter: <span className="text-zinc-300">{filteredStage.label}</span>
								{" · "}
								<Link href="/dashboard/jev-inspector" className="underline hover:text-zinc-300">Alle Stufen zeigen</Link>
							</>
						)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant={auto ? "primary" : "secondary"} onClick={() => setAuto((v) => !v)}>
						{auto ? "Auto-Refresh an" : "Auto-Refresh aus"}
					</Button>
					<Button variant="secondary" onClick={fetchLog}>Aktualisieren</Button>
					<Button variant="danger" onClick={clearLog}>Leeren</Button>
				</div>
			</div>

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
		</div>
	);
}
