"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import RequestDetailsTab from "./components/RequestDetailsTab";
import ProviderLimits from "./components/ProviderLimits";
import ActiveQuotas from "./components/ActiveQuotas";
import PeakHoursBanner from "./components/PeakHoursBanner";
import JevStatsCard from "./components/JevStatsCard";
import JevChart from "./components/JevChart";
import ModelHealthCard from "./components/ModelHealthCard";
import JevRequestLogCard from "../debug/JevRequestLogCard";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [period, setPeriod] = useState("today");
  const [widgets, setWidgets] = useState({});

  // Widget visibility from settings.widgets (missing key = enabled)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : {}))
      .then((settings) => {
        if (!cancelled) setWidgets(settings.widgets || {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "analytics", "logs", "details", "quota", "jev"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <PeakHoursBanner />

      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "analytics", label: "Analytics" },
            { value: "quota", label: "Quota Tracker" },
            { value: "details", label: "Details" },
            { value: "jev", label: "Jev" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        {activeTab === "analytics" && (
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            size="sm"
            className="w-full sm:w-auto"
          />
        )}
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats mode="overview" widgets={widgets} />
          <JevStatsCard period={period} />
          <JevChart period={period} />
          <ModelHealthCard />
          {widgets.activeQuotas !== false && (
            <div className="mt-6">
              <ActiveQuotas />
            </div>
          )}
        </Suspense>
      )}
      {activeTab === "analytics" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats mode="analytics" period={period} setPeriod={setPeriod} hidePeriodSelector />
        </Suspense>
      )}
      {activeTab === "quota" && (
        <Suspense fallback={<CardSkeleton />}>
          <ProviderLimits />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}
      {activeTab === "jev" && <JevRequestLogCard />}
    </div>
  );
}
