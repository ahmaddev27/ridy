"use client";

/**
 * TEMPORARY Sentry verification page. Open /debug/sentry, then trigger a
 * frontend and/or backend error to confirm each project receives events.
 * Remove this route once Sentry is verified.
 */
export default function SentryDebugPage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";

  function throwFrontendError() {
    // Thrown on the next tick so it becomes an uncaught window error, which the
    // Sentry browser SDK's global handler reports (no error boundary needed).
    setTimeout(() => {
      throw new Error("Sentry frontend test error — triggered from /debug/sentry.");
    }, 0);
  }

  async function triggerBackendError() {
    // Hits the temporary backend route, which throws a 500 the backend Sentry
    // reports. The fetch itself will fail with 500 — that is expected.
    try {
      const res = await fetch(`${apiUrl}/api/v1/debug/boom`, { credentials: "include" });
      alert(`Backend responded ${res.status} — check the Sentry backend project.`);
    } catch {
      alert("Backend request failed — check the Sentry backend project.");
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold text-ink">Sentry test</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Trigger an error in each project to confirm Sentry is receiving events. Temporary page — remove after verifying.
        </p>
      </div>

      <button
        onClick={triggerBackendError}
        className="rounded-lg bg-ink px-4 py-3 text-sm font-medium text-canvas hover:opacity-90"
      >
        Trigger backend error (500)
      </button>

      <button
        onClick={throwFrontendError}
        className="rounded-lg border border-line px-4 py-3 text-sm font-medium text-ink hover:bg-surface-2"
      >
        Trigger frontend error
      </button>
    </div>
  );
}
