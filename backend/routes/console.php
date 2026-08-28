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

// Backfill trip geocoding for offers whose lazy enrich failed (rate-limited services).
Schedule::command('offers:backfill-geo --limit=300')->everyFiveMinutes()->withoutOverlapping();

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
