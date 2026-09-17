"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Session } from "@supabase/supabase-js";
import { clearReplica, db, getMeta, setMeta } from "@/lib/db/dexie";
import { setCurrentUser } from "@/lib/db/mutations";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import { syncNow } from "./engine";

type AuthState = "loading" | "signed-out" | "signed-in";

interface AppContextValue {
  auth: AuthState;
  userId: string | null;
  email: string | null;
  online: boolean;
  /** Writes waiting to reach the server. */
  pending: number;
  lastSyncedAt: string | null;
  /** Set when an op cannot be replayed and the queue is stuck. */
  blockedError: string | null;
  sync: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

/** How often to reconcile with the server while the tab is open and online. */
const POLL_MS = 60_000;

export function AppProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(isSupabaseConfigured() ? "loading" : "signed-out");
  const [session, setSession] = useState<Session | null>(null);
  const [online, setOnline] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);

  // One sync at a time. Without this, the outbox-changed effect and the poll
  // timer race and the same op gets pushed twice.
  const running = useRef(false);

  const pending = useLiveQuery(() => db.outbox.count(), [], 0) ?? 0;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const sb = supabase();

    let active = true;
    void sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuth(data.session ? "signed-in" : "signed-out");
    });

    const { data: subscription } = sb.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setAuth(next ? "signed-in" : "signed-out");
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id ?? null;

  // The local cache belongs to one user. If a different one signs in, drop it
  // rather than letting their rows blend together.
  useEffect(() => {
    setCurrentUser(userId);
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const known = await getMeta("user_id");
      if (cancelled) return;
      if (known && known !== userId) await clearReplica();
      await setMeta("user_id", userId);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const sync = useCallback(async () => {
    if (running.current || !userId || !navigator.onLine) return;
    running.current = true;
    // Nothing is set on React state before the first await here: the outbox
    // count already tells the UI that work is in flight, so a separate
    // "syncing" flag would only add a render on every tick.
    try {
      const result = await syncNow();
      setBlockedError(result.blocked?.last_error ?? null);
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      // Offline or a transient server error. The outbox keeps the write, so
      // this is not something to interrupt the user about.
      setBlockedError(null);
      if (process.env.NODE_ENV !== "production") console.warn("sync failed", error);
    } finally {
      running.current = false;
    }
  }, [userId]);

  // Sync on sign-in, whenever work is queued, when the network returns, when
  // the tab is refocused, and on a slow poll to pick up other devices.
  //
  // This is the textbook case for an effect: keeping an external system (the
  // server) in step with local state. `sync` awaits before it touches React
  // state, so it cannot cascade a render; the rule cannot see through the
  // async boundary to tell.
  useEffect(() => {
    if (!userId || !online) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sync();
    const timer = window.setInterval(() => void sync(), POLL_MS);
    const onFocus = () => void sync();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [userId, online, sync]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pending > 0) void sync();
  }, [pending, sync]);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
    await clearReplica();
    setCurrentUser(null);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      auth,
      userId,
      email: session?.user.email ?? null,
      online,
      pending,
      lastSyncedAt,
      blockedError,
      sync,
      signOut,
    }),
    [auth, userId, session, online, pending, lastSyncedAt, blockedError, sync, signOut],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
