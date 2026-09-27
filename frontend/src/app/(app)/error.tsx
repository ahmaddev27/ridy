"use client";

import { ErrorFallback } from "@/components/error-fallback";

/**
 * Route error boundary for every app page. It sits below (app)/layout.tsx, so a
 * page that throws while rendering shows this panel inside the shell — the
 * sidebar, topbar and the new-offer alerts keep running.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorFallback error={error} retry={retry} />;
}
