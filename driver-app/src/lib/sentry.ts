import * as Sentry from "@sentry/react-native";

// DSN is inlined at build time via EXPO_PUBLIC_. Empty = Sentry stays inert, so
// local runs and DSN-less builds behave exactly as before.
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** Initialize crash/error reporting once, only when a DSN is configured. */
export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    // Errors only — no performance tracing (lighter, and easy on the free tier).
    tracesSampleRate: 0,
  });
}

export { Sentry };
