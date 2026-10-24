"use client";

import { Guard, Shell } from "@/components/Shell";
import { WalletsTab } from "@/components/tabs/WalletsTab";

export default function WalletsPage() {
  return (
    <Guard>
      <Shell>
        <WalletsTab />
      </Shell>
    </Guard>
  );
}
