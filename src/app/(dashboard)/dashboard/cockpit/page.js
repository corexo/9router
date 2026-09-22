"use client";

import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components";
import CockpitClient from "./CockpitClient";

export default function CockpitPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <CockpitClient />
    </Suspense>
  );
}
