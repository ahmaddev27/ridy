<?php

use App\Domain\System\InfrastructureHealthService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Drain queued jobs (GeocodeOffer, SyncTripFromWaypoints, …) every minute via the
// scheduler, so they actually run even without a dedicated `queue:work` daemon. A
// missing worker was leaving the database queue's jobs unprocessed — offers never
// geocoded (distance/€-per-km blank until a manager opened the detail) and accepted
// trips never got their Uber-waypoint address/stop correction. --stop-when-empty
// exits the moment the queue is drained; --max-time keeps each run under the minute;
// withoutOverlapping stops two runs stacking. Harmless if a real worker also runs.
Schedule::command('queue:work --stop-when-empty --max-time=50 --tries=3 --sleep=1')
    ->everyMinute()
    ->withoutOverlapping();

// Scheduler heartbeat: stamp a shared (database-cache) timestamp every minute so the
// admin System Health board can tell whether the scheduler container is actually
// ticking — a stale/missing stamp means nothing scheduled (queue drain, backfill,
// expiry) is running.
Schedule::call(fn () => Cache::put(InfrastructureHealthService::HEARTBEAT_KEY, now()->toIso8601String(), 3600))
    ->everyMinute()
    ->name('scheduler-heartbeat')
    ->withoutOverlapping();

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
