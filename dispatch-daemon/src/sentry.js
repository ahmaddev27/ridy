// Sentry error tracking for the daemon. Completely inert unless SENTRY_DSN is
// set, so local runs and DSN-less deploys behave exactly as before.

import * as Sentry from "@sentry/node";
import { config } from "./config.js";
import { scrubSensitive } from "./util.js";

let enabled = false;

// Every event and breadcrumb is scrubbed before it leaves the box: the daemon's
// requests carry the shared dispatch secret (X-Dispatch-Secret) and customers'
// decrypted Uber cookies, and its log lines can carry proxy credentials. None of
// that may reach a third-party error tracker.
const secrets = () => [config.dispatchSecret];

function scrubEvent(event) {
  try {
    return scrubSensitive(event, secrets());
  } catch {
    return null; // never ship an event we could not scrub
  }
}

function scrubBreadcrumb(breadcrumb) {
  try {
    return scrubSensitive(breadcrumb, secrets());
  } catch {
    return null;
  }
}

export function initSentry() {
  if (!config.sentryDsn) return;
  Sentry.init({
    dsn: config.sentryDsn,
    environment: process.env.NODE_ENV || "production",
    serverName: `daemon-${config.shardId}`,
    tracesSampleRate: 0, // errors only; the daemon is not a traced web service
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
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

/**
 * Report an error at most once per `windowMs` for the given key, so a condition
 * that persists (a malformed session row, a backend outage) doesn't send an
 * event every poll.
 */
const lastReportedAt = new Map();
export function captureThrottled(key, error, context, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const last = lastReportedAt.get(key);
  if (last !== undefined && now - last < windowMs) return;
  lastReportedAt.set(key, now);
  captureException(error, context);
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
