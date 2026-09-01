"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/api/admin";

/**
 * Forwards uncaught client-side errors (window.onerror + unhandled promise
 * rejections) to the backend's frontend log, so the admin can watch them on the
 * System Health "Logs" tab. Best-effort and de-duped within the session so a single
 * repeating error can't spam the log; Sentry still gets the full report.
 */
export function ClientErrorReporter() {
  useEffect(() => {
    const sent = new Set<string>();
    const report = (message: string) => {
      const key = message.slice(0, 200);
      if (sent.has(key)) return;
      sent.add(key);
      void reportClientError(message, typeof location !== "undefined" ? location.pathname : undefined);
    };

    const onError = (e: ErrorEvent) =>
      report(`${e.message}${e.filename ? ` @ ${e.filename}:${e.lineno}:${e.colno}` : ""}`);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string } | string | undefined;
      report(`Unhandled rejection: ${typeof r === "object" && r?.message ? r.message : String(r)}`);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
