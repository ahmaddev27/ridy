"use client";

import { useSyncExternalStore } from "react";
import { supportsPasskeys } from "@/lib/webauthn";

// Browser support can't change while the page is open, so there is nothing to subscribe to.
const subscribe = () => () => {};

/**
 * Whether this browser can use passkeys. `null` on the server and until
 * hydration has finished, so callers can tell "not known yet" from "unsupported"
 * and never flash a control (or a hint) that they then take away.
 */
export function usePasskeySupport(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribe, supportsPasskeys, () => null);
}
