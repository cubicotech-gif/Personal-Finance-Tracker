"use client";

import { Guard, Shell } from "@/components/Shell";
import { OwedTab } from "@/components/tabs/OwedTab";

export default function OwedPage() {
  return (
    <Guard>
      <Shell>
        <OwedTab />
      </Shell>
    </Guard>
  );
}
