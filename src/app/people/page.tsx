"use client";

import { Guard, Shell } from "@/components/Shell";
import { PeopleScreen } from "@/components/people/PeopleScreen";

export default function PeoplePage() {
  return (
    <Guard>
      <Shell title="People">
        <PeopleScreen />
      </Shell>
    </Guard>
  );
}
