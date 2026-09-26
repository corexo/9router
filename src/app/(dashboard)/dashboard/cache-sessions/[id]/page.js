import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components";
import CacheSessionDetailClient from "./CacheSessionDetailClient";

export default async function CacheSessionDetailPage({ params }) {
  const { id } = await params;
  return (
    <Suspense fallback={<CardSkeleton />}>
      <CacheSessionDetailClient id={id} />
    </Suspense>
  );
}
