"use client";

import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components";
import FlowClient from "./FlowClient";

export default function FlowPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <FlowClient />
    </Suspense>
  );
}
