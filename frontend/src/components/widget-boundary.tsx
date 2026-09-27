"use client";

import { useEffect } from "react";
import { catchError, type ErrorInfo } from "next/error";
import { ErrorFallback, reportBoundaryError } from "@/components/error-fallback";

function asError(value: unknown): Error & { digest?: string } {
  return value instanceof Error ? value : new Error(String(value));
}

function WidgetFallback(props: { silent?: boolean }, { error, retry }: ErrorInfo) {
  const err = asError(error);
  // A background widget (e.g. the offer-alert watcher) renders nothing visible,
  // so its fallback stays invisible too — it is still reported.
  if (props.silent) return <SilentReport error={err} />;
  return <ErrorFallback error={err} retry={retry} compact />;
}

function SilentReport({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    reportBoundaryError(error);
  }, [error]);
  return null;
}

/**
 * Component-level error boundary: one broken widget (the live map, a chart, the
 * offer-alert watcher) can no longer take the whole page or app shell down.
 */
export const WidgetBoundary = catchError(WidgetFallback);
