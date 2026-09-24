"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { reportClientError } from "@/lib/api/admin";
import { captureException } from "@/components/sentry-init";

/** Send a caught render error to the admin log + Sentry (best-effort). */
export function reportBoundaryError(error: Error & { digest?: string }): void {
  const where = typeof location !== "undefined" ? location.pathname : undefined;
  void reportClientError(`Render error: ${error.message}${error.digest ? ` digest=${error.digest}` : ""}`, where);
  captureException(error);
}

/**
 * The localized "something broke" panel used by the route error boundaries. It
 * renders inside the app shell, so the sidebar, topbar and offer alerts stay up
 * while only the failing page shows this.
 */
export function ErrorFallback({
  error,
  retry,
  compact = false,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();

  useEffect(() => {
    reportBoundaryError(error);
  }, [error]);

  return (
    <div
      role="alert"
      className={
        compact
          ? "flex items-center gap-3 rounded-xl border border-line bg-surface p-4 text-sm"
          : "mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center"
      }
    >
      <AlertTriangle className="h-6 w-6 shrink-0 text-warning-fg" />
      <div className={compact ? "flex-1" : undefined}>
        <p className="font-semibold text-ink">{t("common.errorTitle")}</p>
        <p className="mt-1 text-sm text-ink-muted">{t("common.errorBody")}</p>
      </div>
      <Button variant="secondary" onClick={() => retry()}>
        <RotateCcw className="h-4 w-4" />
        {t("common.retry")}
      </Button>
    </div>
  );
}
