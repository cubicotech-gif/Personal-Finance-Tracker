"use client";

import { Guard, Shell } from "@/components/Shell";
import { LedgerTab } from "@/components/tabs/LedgerTab";

export default function LedgerPage() {
  return (
    <Guard>
      <Shell>
        <LedgerTab />
      </Shell>
    </Guard>
  );
}
