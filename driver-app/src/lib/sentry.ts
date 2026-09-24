import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";

// The DSN is public. It is read from the build env (EXPO_PUBLIC_, inlined at
// build time) with app.json `extra.sentryDsn` as the fallback — an `eas update`
// published without the env var must not silently switch crash reporting off.
// Empty = Sentry stays inert (local runs).
const dsn =
  process.env.EXPO_PUBLIC_SENTRY_DSN || (Constants.expoConfig?.extra?.sentryDsn as string | undefined) || "";

/** Drop the query string: search terms (rider names, addresses) live there. */
function stripQuery(url: unknown): unknown {
  return typeof url === "string" ? url.split("?")[0] : url;
}

/** Initialize crash/error reporting once, only when a DSN is configured. */
export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    // Errors only — no performance tracing (lighter, and easy on the free tier).
    tracesSampleRate: 0,
    // DSGVO "detect, don't surveil": no IPs / user PII attached by default.
    sendDefaultPii: false,
    environment: Updates.channel || (__DEV__ ? "development" : "unknown"),
    dist: Updates.updateId ?? undefined,
    beforeBreadcrumb(breadcrumb) {
      if ((breadcrumb.category === "fetch" || breadcrumb.category === "xhr") && breadcrumb.data) {
        breadcrumb.data.url = stripQuery(breadcrumb.data.url);
        delete breadcrumb.data["http.query"];
      }
      // Touch breadcrumbs can carry on-screen text (addresses, names).
      if (breadcrumb.category === "touch" || breadcrumb.category === "ui.click") return null;
      return breadcrumb;
    },
    beforeSend(event) {
      if (event.request?.url) event.request.url = stripQuery(event.request.url) as string;
      if (event.request) delete event.request.query_string;
      if (event.user) delete event.user.ip_address;
      return event;
    },
  });
}

export { Sentry };
