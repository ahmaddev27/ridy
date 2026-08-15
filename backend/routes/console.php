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
Schedule::command('offers:backfill-geo')->everyFiveMinutes()->withoutOverlapping();

// Daily heads-up notifications: subscriptions/proxies expiring or expired.
Schedule::command('notifications:scan')->dailyAt('08:00')->withoutOverlapping();
