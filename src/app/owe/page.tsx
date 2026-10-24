"use client";

import { Guard, Shell } from "@/components/Shell";
import { OweTab } from "@/components/tabs/OweTab";

export default function OwePage() {
  return (
    <Guard>
      <Shell>
        <OweTab />
      </Shell>
    </Guard>
  );
}
