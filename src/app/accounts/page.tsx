"use client";

import { Guard, Shell } from "@/components/Shell";
import { AccountsScreen } from "@/components/accounts/AccountsScreen";

export default function AccountsPage() {
  return (
    <Guard>
      <Shell title="Accounts">
        <AccountsScreen />
      </Shell>
    </Guard>
  );
}
