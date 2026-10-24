"use client";

import { Guard, Shell } from "@/components/Shell";
import { SpendTab } from "@/components/tabs/SpendTab";

export default function SpendPage() {
  return (
    <Guard>
      <Shell>
        <SpendTab />
      </Shell>
    </Guard>
  );
}
