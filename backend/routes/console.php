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

// Backfill DISABLED — the self-hosted Nominatim 429s under batch load, which
// starved time-critical live offers of geocoding. Live-offer inline enrich now
// has Nominatim to itself. Re-enable (or run `offers:backfill-geo` manually
// off-peak) only if the geocoder is given more headroom.
// Schedule::command('offers:backfill-geo --limit=60')->everyFiveMinutes()->withoutOverlapping();

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
