"use client";

import { Suspense } from "react";
import { SessionGate } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { Spinner } from "@/components/ui";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const fallback = (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );

  return (
    <SessionGate fallback={fallback}>
      <Suspense fallback={fallback}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </SessionGate>
  );
}
