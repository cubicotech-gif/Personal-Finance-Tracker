"use client";

import { Guard, Shell } from "@/components/Shell";
import { LogScreen } from "@/components/log/LogScreen";

export default function LogPage() {
  return (
    <Guard>
      <Shell title="Log">
        <LogScreen />
      </Shell>
    </Guard>
  );
}
