export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-lg font-semibold">You are offline</h1>
      <p className="text-sm text-muted">
        This page has not been cached yet. Anything you logged while offline is saved on this device and
        will sync once you are back online.
      </p>
    </main>
  );
}
