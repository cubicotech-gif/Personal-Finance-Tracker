import { defaultCache } from "@serwist/next/worker";
import { CacheFirst, NetworkFirst, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * The service worker caches the app shell and nothing else.
 *
 * It deliberately does not cache Supabase responses: offline support here comes
 * from IndexedDB plus the outbox, and a stale cached API response would be a
 * second, conflicting source of truth sitting behind the first one.
 *
 * Precaching is done here rather than by Serwist's own `precacheEntries`.
 * Serwist 9.5 runs its install-time fetches through `parallel()` in
 * @serwist/utils, which passes an `async` function as a Promise executor:
 *
 *     const queues = Array.from({ length: limit }, () => new Promise(processor));
 *
 * A rejection inside that executor is swallowed and `resolve` is never called,
 * so a single failing asset leaves one queue pending forever, `Promise.all`
 * never settles and the worker is stuck in `installing` — no activation, no
 * fetch handler, no offline support at all. Warming the cache directly with
 * `allSettled` means one bad asset costs that asset, not the whole worker.
 */

const SHELL = "app-shell";

/**
 * Serwist's build manifest covers hashed build assets. App Router routes are
 * not in it, so they are added explicitly — without them a cold reload while
 * offline has no document to serve.
 */
const SHELL_ROUTES = ["/log", "/boxes", "/accounts", "/people", "/setup", "/login", "/offline"];

const manifestUrls = (self.__SW_MANIFEST ?? []).map((entry) =>
  typeof entry === "string" ? entry : entry.url,
);

const shellUrls = [...SHELL_ROUTES, ...manifestUrls];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await Promise.allSettled(shellUrls.map((url) => cache.add(url)));
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Build assets are content-hashed, so last deploy's entries are dead
      // weight. Drop anything the current build does not reference.
      const wanted = new Set(shellUrls.map((url) => new URL(url, self.location.origin).href));
      const cache = await caches.open(SHELL);
      await Promise.all(
        (await cache.keys()).map((request) =>
          wanted.has(request.url) ? undefined : cache.delete(request),
        ),
      );
    })(),
  );
});

const serwist = new Serwist({
  // Empty on purpose — see the note above. The install handler does this work.
  precacheEntries: [],
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [
    {
      // Network first so a deploy is picked up immediately, falling back to the
      // warmed shell when offline. A successful navigation refreshes the entry,
      // so routes reached after install stay current too.
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({ cacheName: SHELL, networkTimeoutSeconds: 5 }),
    },
    {
      // Build output is immutable under its hash, so it never needs revalidating.
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({ cacheName: SHELL }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
