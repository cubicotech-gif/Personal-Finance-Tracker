"use client";

import { Suspense } from "react";
import { Guard, Shell } from "@/components/Shell";
import { PeopleScreen } from "@/components/people/PeopleScreen";

export default function PeoplePage() {
  return (
    <Guard>
      <Shell title="People">
        {/* PeopleScreen reads ?person= to open one person straight away. */}
        <Suspense fallback={null}>
          <PeopleScreen />
        </Suspense>
      </Shell>
    </Guard>
  );
}
