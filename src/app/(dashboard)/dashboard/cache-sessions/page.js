"use client";

import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components";
import CacheSessionsClient from "./CacheSessionsClient";

export default function CacheSessionsPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <CacheSessionsClient />
    </Suspense>
  );
}
