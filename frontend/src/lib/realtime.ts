"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import Echo from "laravel-echo";
import Pusher from "pusher-js";

// Empty in production (same-origin behind Caddy) — so it must never be fed to
// `new URL()` unguarded, and must never default to localhost when it is empty.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const KEY = process.env.NEXT_PUBLIC_REVERB_KEY ?? "";

/**
 * Where the Reverb WebSocket lives. Reverb is served via Caddy at
 * wss://<host>/app/<key>, so it defaults to the API host — or, when the API is
 * same-origin (NEXT_PUBLIC_API_URL built empty, as in production), to the page's
 * own host. NEXT_PUBLIC_REVERB_HOST overrides it only when Reverb runs elsewhere.
 * Resolved lazily in the browser: at module load `window` may not exist.
 */
export function resolveRealtimeEndpoint(): { host: string; port: number; tls: boolean } {
  const tls = window.location.protocol === "https:";
  let host = process.env.NEXT_PUBLIC_REVERB_HOST || "";
  if (!host && API_URL) {
    try {
      host = new URL(API_URL).hostname;
    } catch {
      /* fall through to the page host */
    }
  }
  if (!host) host = window.location.hostname;
  const port = Number(process.env.NEXT_PUBLIC_REVERB_PORT) || (tls ? 443 : 8080);
  return { host, port, tls };
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[2]) : "";
}

type Handler = (payload: unknown) => void;

// The bits of an Echo instance we use, as a structural type — so this file never
// references laravel-echo's `Echo<T>` generic (its shape differs across v1/v2 and
// tripped the CI type-check). We construct through a cast to this shape.
type EchoChannel = {
  listen(event: string, cb: Handler): unknown;
  stopListening(event: string, cb?: Handler): unknown;
};
type EchoLike = {
  private(channel: string): EchoChannel;
  leave(channel: string): void;
  disconnect(): void;
  connector?: {
    pusher?: {
      connection?: {
        state?: string;
        bind(event: string, cb: (s: { current: string }) => void): void;
      };
    };
  };
};

// ---------------------------------------------------------------------------
// One shared socket per browser tab. Every hook call used to open its own Echo
// connection (the dashboard held two to the same channel); now all subscribers
// share one, reference-counted, and it lingers briefly after the last one leaves
// so a route change (dashboard → offers) reuses it instead of reconnecting.
// ---------------------------------------------------------------------------

const LINGER_MS = 5000;

let echo: EchoLike | null = null;
let echoTenant: number | null = null;
let refCount = 0;
let lingerTimer: ReturnType<typeof setTimeout> | null = null;

let connected = false;
const connectionListeners = new Set<() => void>();

function setConnected(next: boolean) {
  if (connected === next) return;
  connected = next;
  connectionListeners.forEach((l) => l());
}

function teardown() {
  if (!echo) return;
  try {
    if (echoTenant != null) echo.leave(`company.${echoTenant}`);
    echo.disconnect();
  } catch {
    /* already gone */
  }
  echo = null;
  echoTenant = null;
  setConnected(false);
}

function createEcho(): EchoLike | null {
  const { host, port, tls } = resolveRealtimeEndpoint();
  // Cast the constructor to a plain (non-generic) signature so compilation
  // never depends on laravel-echo's `Echo<T>` generic. The runtime accepts the
  // reverb broadcaster + injected Pusher + custom authorizer on both v1 and v2.
  const EchoCtor = Echo as unknown as new (options: Record<string, unknown>) => EchoLike;
  const instance = new EchoCtor({
    broadcaster: "reverb",
    Pusher, // reverb uses the Pusher connector under the hood
    key: KEY,
    wsHost: host,
    wsPort: port,
    wssPort: port,
    forceTLS: tls,
    enabledTransports: ["ws", "wss"],
    // Sanctum SPA cookie auth: authorize over fetch with credentials + the CSRF
    // header, since the private-channel auth is a state-changing POST.
    authorizer: (ch: { name: string }) => ({
      authorize: (socketId: string, callback: (error: unknown, data?: unknown) => void) => {
        fetch(`${API_URL}/api/v1/broadcasting/auth`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-XSRF-TOKEN": readCookie("XSRF-TOKEN"),
          },
          body: JSON.stringify({ socket_id: socketId, channel_name: ch.name }),
        })
          .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
          .then((data) => callback(null, data))
          .catch((err) => callback(err));
      },
    }),
  });
  const conn = instance.connector?.pusher?.connection;
  conn?.bind("state_change", (s) => setConnected(s.current === "connected"));
  setConnected(conn?.state === "connected");
  return instance;
}

/** Acquire the shared socket for a tenant (creating or re-targeting it). */
function acquire(tenantId: number): EchoLike | null {
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
  if (echo && echoTenant !== tenantId) teardown();
  if (!echo) {
    echo = createEcho();
    echoTenant = tenantId;
  }
  refCount++;
  return echo;
}

function release() {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0 || lingerTimer) return;
  lingerTimer = setTimeout(() => {
    lingerTimer = null;
    if (refCount === 0) teardown();
  }, LINGER_MS);
}

/** Close the shared socket now (e.g. on logout), regardless of subscribers. */
export function disconnectRealtime(): void {
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
  refCount = 0;
  teardown();
}

/** True while the shared Reverb socket is connected — pollers can back off. */
export function useRealtimeConnected(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      connectionListeners.add(onChange);
      return () => connectionListeners.delete(onChange);
    },
    () => connected,
    () => false,
  );
}

/** Event payload of `.offer.changed` (App\Events\OfferBroadcast::broadcastWith). */
export type OfferChangedPayload = { offer_id?: number; reason?: string };

/**
 * Subscribe the manager's own company channel over Laravel Reverb and call
 * `onChange(payload)` whenever the event fires (by default an offer arrives or
 * its status moves), so the dashboard / offers feed refreshes instantly instead
 * of waiting for the poll.
 *
 * Tenant isolation is enforced server-side in routes/channels.php (a user may only
 * authorize their own `company.{tenantId}`), so one manager can never receive
 * another company's events. Best-effort: no-ops (leaving the poll as the safety
 * net) when Reverb isn't configured or there's no tenant, and swallows any
 * connection failure. The latest `onChange` is always used without
 * resubscribing (kept in a ref), so callers need not memoize it.
 */
export function useCompanyRealtime(
  tenantId: number | null | undefined,
  onChange: (payload: unknown) => void,
  event = ".offer.changed",
): void {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!KEY || !tenantId || typeof window === "undefined") return;

    const channelName = `company.${tenantId}`;
    const handler: Handler = (payload) => cb.current(payload);
    let channel: EchoChannel | null = null;
    try {
      const instance = acquire(tenantId);
      channel = instance?.private(channelName) ?? null;
      channel?.listen(event, handler);
    } catch {
      /* keep polling */
    }

    return () => {
      try {
        channel?.stopListening(event, handler);
      } catch {
        /* already gone */
      }
      release();
    };
  }, [tenantId, event]);
}
