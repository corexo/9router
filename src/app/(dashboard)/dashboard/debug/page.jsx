"use client";

import JevRequestLogCard from "./JevRequestLogCard";

export default function DebugPage() {
  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold mb-2">Debug & Monitoring</h1>
        <p className="text-gray-600">Live monitoring of Jev requests</p>
      </div>
      <JevRequestLogCard />
    </div>
  );
}
