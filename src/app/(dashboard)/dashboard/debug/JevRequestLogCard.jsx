"use client";

import React, { useState, useEffect } from "react";

export default function JevRequestLogCard() {
  const [log, setLog] = useState([]);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchLog = async () => {
    try {
      const res = await fetch("/api/debug/jev");
      const data = await res.json();
      setLog(data.log || []);
    } catch (err) {
      console.error("Failed to fetch Jev log:", err);
    }
  };

  useEffect(() => {
    fetchLog();
    const interval = setInterval(fetchLog, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleClear = async () => {
    setLoading(true);
    try {
      await fetch("/api/debug/jev", { method: "DELETE" });
      setLog([]);
    } catch (err) {
      console.error("Failed to clear log:", err);
    } finally {
      setLoading(false);
    }
  };

  const latest = log[0];

  return (
    <div className="border rounded-lg p-4 bg-slate-50">
      <div
        className="flex items-center justify-between cursor-pointer hover:bg-slate-100 p-2 rounded"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{expanded ? "▼" : "▶"}</span>
          <h3 className="font-semibold">Jev Request Criteria</h3>
          <span className="text-sm text-gray-600">({log.length} requests logged)</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleClear();
          }}
          disabled={loading}
          className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
        >
          Clear
        </button>
      </div>

      {expanded && !latest && (
        <div className="mt-4 pt-4 border-t text-sm text-gray-500">
          No Jev requests logged yet. Send a request with model "jev" to see it here.
        </div>
      )}

      {expanded && latest && (
        <div className="mt-4 pt-4 border-t space-y-4">
          <div className="text-sm">
            <div className="font-semibold text-gray-700 mb-2">Latest Request</div>
            <div className="bg-white p-3 rounded border border-gray-200 space-y-2">
              <div>
                <span className="text-gray-600">Time: </span>
                <span className="font-mono text-xs">
                  {new Date(latest.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div>
                <span className="text-gray-600">Models sent to Jev: </span>
                <span className="font-semibold">{latest.numModels}</span>
              </div>
              <div>
                <span className="text-gray-600">Enriched criteria: </span>
                <span className="font-semibold">{latest.enrichCriteria ? "YES (cost/usage/account)" : "NO (bare names only)"}</span>
              </div>

              {latest.selectedModel && (
                <div className="bg-green-50 border border-green-300 rounded p-2">
                  <span className="text-gray-700">Jev selected: </span>
                  <span className="font-bold text-green-800">{latest.selectedModel}</span>
                  {latest.resolvedThinking && (
                    <span className="ml-2 text-purple-700 font-semibold">Thinking: {latest.resolvedThinking}</span>
                  )}
                </div>
              )}

              {latest.invalid && (
                <div className="bg-yellow-50 border border-yellow-300 rounded p-2">
                  <span className="text-yellow-800">Invalid Jev answer: </span>
                  <span className="font-mono text-xs">{String(latest.rawSelected)}</span>
                </div>
              )}

              {latest.error && (
                <div className="bg-red-50 border border-red-300 rounded p-2">
                  <span className="text-red-800">Jev error: </span>
                  <span className="font-mono text-xs">{latest.error}</span>
                </div>
              )}

              {latest.fallbackUsed && (
                <div className="bg-orange-50 border border-orange-300 rounded p-2">
                  <span className="text-orange-800">Fallback used: </span>
                  <span className="font-bold">{latest.fallbackUsed}</span>
                  <span className="ml-2 text-xs text-gray-600">({latest.fallbackReason})</span>
                </div>
              )}

              {latest.prompt && (
                <div className="mt-3">
                  <div className="font-semibold text-gray-700 mb-2">Prompt sent to Jev (state, truncated 3000 chars):</div>
                  <div className="bg-gray-50 p-2 rounded border border-gray-200 max-h-40 overflow-y-auto text-xs whitespace-pre-wrap">
                    {latest.prompt}
                  </div>
                </div>
              )}

              <div className="mt-3">
                <div className="font-semibold text-gray-700 mb-2">Model Criteria (target_model question):</div>
                <div className="bg-gray-50 p-2 rounded border border-gray-200 max-h-96 overflow-y-auto text-xs font-mono space-y-1">
                  {Object.entries(latest.modelCriteria || latest.criteria || {}).map(([model, desc]) => (
                    <div key={model} className="pb-2 border-b border-gray-300 last:border-0">
                      <div className="text-blue-700 font-semibold">{model}</div>
                      <div className="text-gray-700 ml-2 text-xs break-words">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {latest.thinkingCriteria && (
                <div className="mt-3">
                  <div className="font-semibold text-gray-700 mb-2">Thinking Level Criteria (target_thinking question):</div>
                  <div className="bg-gray-50 p-2 rounded border border-gray-200 text-xs font-mono space-y-1">
                    {Object.entries(latest.thinkingCriteria).map(([level, desc]) => (
                      <div key={level} className="pb-2 border-b border-gray-300 last:border-0">
                        <div className="text-purple-700 font-semibold">{level}</div>
                        <div className="text-gray-700 ml-2 text-xs break-words">{desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {log.length > 1 && (
            <div className="text-sm">
              <div className="font-semibold text-gray-700 mb-2">Recent History</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {log.slice(1, 6).map((req, i) => (
                  <div
                    key={i}
                    className="text-xs text-gray-600 bg-white p-2 rounded border border-gray-200"
                  >
                    <span>{new Date(req.timestamp).toLocaleTimeString()}</span>
                    <span className="ml-2">• {req.numModels} models</span>
                    {req.selectedModel && <span className="ml-2 text-green-700 font-semibold">→ {req.selectedModel}{req.resolvedThinking ? ` (${req.resolvedThinking})` : ""}</span>}
                    {req.fallbackUsed && <span className="ml-2 text-orange-700 font-semibold">→ fallback: {req.fallbackUsed}</span>}
                    {req.error && <span className="ml-2 text-red-700 font-semibold">→ error: {req.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
