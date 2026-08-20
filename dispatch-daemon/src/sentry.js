// Sentry error tracking for the daemon. Completely inert unless SENTRY_DSN is
// set, so local runs and DSN-less deploys behave exactly as before.

import * as Sentry from "@sentry/node";
import { config } from "./config.js";

let enabled = false;

export function initSentry() {
  if (!config.sentryDsn) return;
  Sentry.init({
    dsn: config.sentryDsn,
    environment: process.env.NODE_ENV || "production",
    serverName: `daemon-${config.shardId}`,
    tracesSampleRate: 0, // errors only; the daemon is not a traced web service
  });
  enabled = true;
  console.log("Sentry error tracking enabled");
}

/** Report an error, tagging it with where it happened. Never throws. */
export function captureException(error, context) {
  if (!enabled) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    /* telemetry must never break the daemon */
  }
}

/** Flush buffered events before the process exits (best-effort). */
export async function flush(timeoutMs = 2000) {
  if (!enabled) return;
  try {
    await Sentry.close(timeoutMs);
  } catch {
    /* ignore */
  }
}
