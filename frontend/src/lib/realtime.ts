"use client";

import { useEffect, useRef } from "react";
import Echo from "laravel-echo";
import Pusher from "pusher-js";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const KEY = process.env.NEXT_PUBLIC_REVERB_KEY ?? "";

// Reverb is served via Caddy at wss://<host>/app/<key>. Default the WebSocket host
// to the API host; override with NEXT_PUBLIC_REVERB_HOST only if Reverb runs on a
// different hostname.
const HOST =
  process.env.NEXT_PUBLIC_REVERB_HOST ??
  (() => {
    try {
      return new URL(API_URL).hostname;
    } catch {
      return "localhost";
    }
  })();

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[2]) : "";
}

// The bits of an Echo instance we use, as a structural type — so this file never
// references laravel-echo's `Echo<T>` generic (its shape differs across v1/v2 and
// tripped the CI type-check). We construct through a cast to this shape.
type EchoLike = {
  private(channel: string): { listen(event: string, cb: () => void): unknown };
  leave(channel: string): void;
  disconnect(): void;
};

/**
 * Subscribe the manager's own company channel over Laravel Reverb and call
 * `onOfferChange` whenever an offer arrives or its status moves, so the dashboard
 * / offers feed refreshes instantly instead of waiting for the poll.
 *
 * Tenant isolation is enforced server-side in routes/channels.php (a user may only
 * authorize their own `company.{tenantId}`), so one manager can never receive
 * another company's events. Best-effort: no-ops (leaving the poll as the safety
 * net) when Reverb isn't configured or there's no tenant, and swallows any
 * connection failure. The latest `onOfferChange` is always used without
 * resubscribing (kept in a ref), so callers need not memoize it.
 */
export function useCompanyRealtime(tenantId: number | null | undefined, onOfferChange: () => void): void {
  const cb = useRef(onOfferChange);
  cb.current = onOfferChange;

  useEffect(() => {
    if (!KEY || !tenantId || typeof window === "undefined") return;

    let echo: EchoLike | null = null;
    const channel = `company.${tenantId}`;
    try {
      // Cast the constructor to a plain (non-generic) signature so compilation
      // never depends on laravel-echo's `Echo<T>` generic. The runtime accepts the
      // reverb broadcaster + injected Pusher + custom authorizer on both v1 and v2.
      const EchoCtor = Echo as unknown as new (options: Record<string, unknown>) => EchoLike;
      echo = new EchoCtor({
        broadcaster: "reverb",
        Pusher, // reverb uses the Pusher connector under the hood
        key: KEY,
        wsHost: HOST,
        wsPort: 443,
        wssPort: 443,
        forceTLS: true,
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

      echo.private(channel).listen(".offer.changed", () => cb.current());
    } catch {
      /* keep polling */
    }

    return () => {
      try {
        echo?.leave(channel);
        echo?.disconnect();
      } catch {
        /* already gone */
      }
    };
  }, [tenantId]);
}
