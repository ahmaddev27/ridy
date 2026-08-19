# 21 · Error Monitoring (Sentry / GlitchTip)

Both apps report errors to Sentry — or any Sentry-compatible endpoint like a
**self-hosted GlitchTip** (free forever). Everything is **off until a DSN is
set**, so nothing changes until you opt in.

## Turn it on

Create a project in [sentry.io](https://sentry.io) (free tier) — or run GlitchTip
on a box — and grab the two DSNs. Add these GitHub Actions secrets:

| Secret | Used by |
|---|---|
| `SENTRY_LARAVEL_DSN` | backend (Laravel) — server errors |
| `NEXT_PUBLIC_SENTRY_DSN` | frontend (browser) — client errors |

The deploy writes them into `.env`; the frontend one is a **build arg** (Next
inlines `NEXT_PUBLIC_*` at build time), so a deploy is required after setting it.

## What's wired

- **Backend:** `sentry/sentry-laravel`; `Integration::handles()` in
  `bootstrap/app.php` reports unhandled exceptions.
- **Frontend:** `@sentry/react`, initialized once in `SentryInit` (mounted in the
  root layout) when `NEXT_PUBLIC_SENTRY_DSN` is present. Errors-only (no tracing/
  replay) to stay light and within the free tier. No Sentry build plugin (avoids
  coupling to the Next version); source-map upload is skipped.

## GlitchTip (fully free, self-hosted)

Sentry SDKs speak GlitchTip's API — just point the DSNs at your GlitchTip
instance instead of sentry.io. Run it in Docker on a small box; no code change.

## Also recommended (free)

- **UptimeRobot** — external uptime check on `https://reidey.de/up` (5-min pings),
  so you're alerted if the whole site is down (which app-level error tracking
  can't see). Complements the ops alerts in `docs/20-backup-and-alerts.md`.
