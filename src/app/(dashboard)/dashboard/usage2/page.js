"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CardSkeleton } from "@/shared/components";

function Usage2Redirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const q = searchParams ? searchParams.toString() : "";
    router.replace(`/dashboard/usage${q ? `?${q}` : ""}`);
  }, [router, searchParams]);

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-text-muted">
      <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
        progress_activity
      </span>
      <p className="text-sm font-medium">Weiterleitung zu Usage &amp; Analytics...</p>
    </div>
  );
}

export default function Usage2Page() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <Usage2Redirect />
    </Suspense>
  );
}
