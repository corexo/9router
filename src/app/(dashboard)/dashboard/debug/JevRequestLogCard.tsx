import React, { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";

interface JevRequest {
  timestamp: string;
  numModels: number;
  criteria: Record<string, string>;
}

export function JevRequestLogCard() {
  const [log, setLog] = useState<JevRequest[]>([]);
  const [expanded, setExpanded] = useState(false);
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
          {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          <h3 className="font-semibold">Jev Request Debug</h3>
          <span className="text-sm text-gray-600">({log.length} requests)</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleClear();
          }}
          disabled={loading}
          className="text-red-600 hover:text-red-800 disabled:opacity-50"
          title="Clear log"
        >
          <Trash2 size={18} />
        </button>
      </div>

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
                <span className="text-gray-600">Models: </span>
                <span className="font-semibold">{latest.numModels}</span>
              </div>

              <div className="mt-3">
                <div className="font-semibold text-gray-700 mb-2">Criteria:</div>
                <div className="bg-gray-50 p-2 rounded border border-gray-200 max-h-96 overflow-y-auto text-xs font-mono">
                  {Object.entries(latest.criteria).map(([model, desc]) => (
                    <div key={model} className="mb-2 pb-2 border-b border-gray-300 last:border-0">
                      <div className="text-blue-700 font-semibold">{model}</div>
                      <div className="text-gray-700 ml-2 text-xs break-words">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {log.length > 1 && (
            <div className="text-sm">
              <div className="font-semibold text-gray-700 mb-2">History ({log.length - 1} older)</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {log.slice(1, 6).map((req, i) => (
                  <div key={i} className="text-xs text-gray-600 bg-white p-2 rounded border border-gray-200">
                    <span>{new Date(req.timestamp).toLocaleTimeString()}</span>
                    <span className="ml-2">• {req.numModels} models</span>
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
