"use client";

import { useEffect, useState } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { reportClientError } from "@/lib/api/admin";

/**
 * Last-resort boundary for errors in the root or (app) layout. It replaces the
 * whole document (no providers, no global CSS), so it reads the saved locale
 * itself and styles inline.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [locale, setLocale] = useState<Locale>("de");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("locale");
      if (saved === "en" || saved === "de" || saved === "ar") setLocale(saved);
    } catch {
      /* storage blocked */
    }
    void reportClientError(
      `Global render error: ${error.message}${error.digest ? ` digest=${error.digest}` : ""}`,
      typeof location !== "undefined" ? location.pathname : undefined,
    );
  }, [error]);

  const c = dictionaries[locale].common;

  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f7f7f8",
          color: "#111",
        }}
      >
        <div role="alert" style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <title>{c.errorTitle}</title>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>{c.errorTitle}</h1>
          <p style={{ margin: "0 0 20px", color: "#555" }}>{c.errorBody}</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button onClick={() => retry()} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}>
              {c.retry}
            </button>
            <button onClick={() => window.location.reload()} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#111", color: "#fff", cursor: "pointer" }}>
              {c.reload}
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
