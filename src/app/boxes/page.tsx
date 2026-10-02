"use client";

import { Guard, Shell } from "@/components/Shell";
import { BoxesScreen } from "@/components/boxes/BoxesScreen";

export default function BoxesPage() {
  return (
    <Guard>
      <Shell title="Boxes">
        <BoxesScreen />
      </Shell>
    </Guard>
  );
}
