"use client";

import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components";
import CacheDashboardClient from "./CacheDashboardClient";

export default function CachePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <CacheDashboardClient />
    </Suspense>
  );
}
