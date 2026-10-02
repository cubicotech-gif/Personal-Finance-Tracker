"use client";

import { Button } from "@/components/ui";

export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <p>You are offline and this page is not saved yet. Anything you logged is safe and will sync later.</p>
      <Button type="button" variant="primary" onClick={() => window.location.reload()}>
        Try again
      </Button>
    </main>
  );
}
