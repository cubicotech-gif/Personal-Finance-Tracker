"use client";

import { Suspense } from "react";
import { Guard, Shell } from "@/components/Shell";
import { LogScreen } from "@/components/log/LogScreen";

export default function LogPage() {
  return (
    <Guard>
      <Shell title="Log">
        {/* LogScreen reads ?check= to open a balance check for one account. */}
        <Suspense fallback={null}>
          <LogScreen />
        </Suspense>
      </Shell>
    </Guard>
  );
}
