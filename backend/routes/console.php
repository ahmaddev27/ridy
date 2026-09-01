<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Expire pending offers whose accept window elapsed (safety net for idle tenants).
Schedule::command('offers:expire-pending')->everyMinute()->withoutOverlapping();

// Force-finalize stale offers (over-long trips / abandoned accepts) the poll missed.
Schedule::command('offers:finalize-stale')->everyFiveMinutes()->withoutOverlapping();

// Backfill for offers whose lazy/ingest-time enrich never resolved (hard street-
// only addresses, transient 429s), so their distance/€-per-km shows in the mobile
// "recent" list without anyone opening the detail on the dashboard. Kept GENTLE —
// a tiny batch every 10 min at ~1 req/sec (see the 700ms throttle) — because a
// large fast sweep once 429'd the self-hosted Nominatim and starved live offers.
Schedule::command('offers:backfill-geo --limit=12')->everyTenMinutes()->withoutOverlapping();

// Daily heads-up notifications: subscriptions/proxies expiring or expired.
Schedule::command('notifications:scan')->dailyAt('08:00')->withoutOverlapping();

// Ops alerting: broken Uber sessions / down daemon shards (emailed once each).
Schedule::command('alerts:check')->everyFiveMinutes()->withoutOverlapping();

// Nightly gzipped database backup (kept 7 days in storage/app/backups).
Schedule::command('db:backup')->dailyAt('03:00')->withoutOverlapping();

// Flip expired ads to inactive (scopeLive already hides them; this syncs the flag).
Schedule::command('ads:expire')->hourly()->withoutOverlapping();

// Refresh the local railway-station table from DB InfraGO OpenStation (weekly —
// the dataset changes slowly; a failed run leaves the current data intact).
Schedule::command('stations:sync')->weeklyOn(1, '04:00')->withoutOverlapping();

// Keep the dispatch network log (admin Network tab) to a 48h retention window.
Schedule::command('network-logs:prune')->hourly()->withoutOverlapping();
