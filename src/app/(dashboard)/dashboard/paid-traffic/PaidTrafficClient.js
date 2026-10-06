"use client";

import { useEffect, useState } from "react";
import { Card } from "@/shared/components";

export default function PaidTrafficClient() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/paid-traffic", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (alive) setData(json);
      } catch (err) { if (alive) setError(err.message); }
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const usage = data?.usage || [];
  const maxTokens = Math.max(1, ...usage.map((item) => item.tokens));
  return <div className="space-y-4">
    {error && <Card className="p-4 text-sm text-red-400">Usage load failed: {error}</Card>}
    <Card className="p-4">
      <h2 className="mb-4 font-semibold text-text-main">Paid usage · 7 days</h2>
      {!usage.length ? <p className="text-sm text-text-muted">No paid usage recorded.</p> : <div className="space-y-3">
        {usage.map((item) => <div key={`${item.provider}:${item.account}`}>
          <div className="mb-1 flex justify-between gap-3 text-xs"><span className="text-text-main">{item.provider} · {item.account}</span><span className="text-text-muted">{item.tokens.toLocaleString()} tokens · ${item.cost.toFixed(4)} · {item.requests} req</span></div>
          <div className="h-2 overflow-hidden rounded bg-zinc-800"><div className="h-full rounded bg-blue-500" style={{ width: `${Math.max(2, item.tokens / maxTokens * 100)}%` }} /></div>
        </div>)}
      </div>}
    </Card>
    <Card className="p-4">
      <h2 className="mb-3 font-semibold text-text-main">Jev allocation requests</h2>
      {!data?.entries?.length ? <p className="text-sm text-text-muted">No Jev allocation yet.</p> : <div className="space-y-3">{data.entries.map((entry, index) => <details key={`${entry.timestamp}-${index}`} className="rounded border border-zinc-800 p-3">
        <summary className="cursor-pointer text-sm text-text-main">{new Date(entry.timestamp).toLocaleString()} · {entry.provider} · {entry.selection ? "allocation received" : "waiting or invalid response"}</summary>
        <div className="mt-3 grid gap-3 text-xs md:grid-cols-2"><section><h3 className="mb-1 text-text-muted">Outgoing request</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-zinc-300">{JSON.stringify(entry.request, null, 2)}</pre></section><section><h3 className="mb-1 text-text-muted">Jev response</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-zinc-300">{typeof entry.response === "string" ? entry.response : JSON.stringify(entry.response, null, 2) || "Pending"}</pre></section></div>
        <p className="mt-2 text-xs text-emerald-400">{entry.selection ? JSON.stringify(entry.selection) : "No valid distribution; existing routing preserved."}</p>
      </details>)}</div>}
    </Card>
  </div>;
}
