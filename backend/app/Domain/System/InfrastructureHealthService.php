<?php

namespace App\Domain\System;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/**
 * Live health of the platform's own infrastructure — the queue, the scheduler and
 * the external service containers (Reverb, Nominatim, OSRM) — for the admin System
 * Health board.
 *
 * Rather than reading raw Docker container state (which the backend container can't
 * see without the daemon socket), each service is checked by its FUNCTION: the queue
 * by how fast it drains, the scheduler by a heartbeat it writes every minute, and the
 * external services by whether they answer. That surfaces the failures that actually
 * matter — e.g. a crash-looping queue/scheduler that leaves jobs unprocessed.
 *
 * Every probe is best-effort and time-boxed, degrading to "down" rather than throwing,
 * so the board always renders.
 */
class InfrastructureHealthService
{
    /** Cache key the scheduler stamps each minute (see routes/console.php). */
    public const HEARTBEAT_KEY = 'system:scheduler_heartbeat';

    /** Geo/Reverb are internal containers — bypass the residential proxy. */
    private const NO_PROXY = ['proxy' => ''];

    /** A job waiting longer than this (seconds) means the worker isn't draining. */
    private const QUEUE_STUCK_SECONDS = 300;

    /** The scheduler heartbeat is stale past this (seconds) → the ticker is down. */
    private const SCHEDULER_STALE_SECONDS = 180;

    /** @return array<string, mixed> */
    public function snapshot(): array
    {
        $queue = $this->queue();
        $scheduler = $this->scheduler();
        $reverb = $this->tcpReachable($this->reverbHost(), $this->reverbPort());
        $nominatim = $this->httpReachable((string) config('services.geo.nominatim_url'));
        $osrm = $this->httpReachable((string) config('services.geo.osrm_url'));

        return [
            'queue' => $queue,
            'scheduler' => $scheduler,
            // One row per critical service, each reduced to ok | warn | down so the
            // board reads at a glance. Database is implicitly ok — this query ran.
            'services' => [
                ['key' => 'database', 'status' => 'ok'],
                ['key' => 'queue', 'status' => $queue['status']],
                ['key' => 'scheduler', 'status' => $scheduler['status']],
                ['key' => 'reverb', 'status' => $reverb ? 'ok' : 'down'],
                ['key' => 'nominatim', 'status' => $nominatim ? 'ok' : 'down'],
                ['key' => 'osrm', 'status' => $osrm ? 'ok' : 'down'],
            ],
        ];
    }

    /**
     * Queue depth + whether the worker is keeping up. `available_at` is the unix
     * timestamp a job became runnable; the oldest one still queued, aged against
     * now, tells us if the worker is draining (small) or stalled (growing).
     *
     * @return array{pending: int, failed: int, oldest_pending_seconds: int|null, status: string}
     */
    private function queue(): array
    {
        $pending = (int) rescue(fn () => DB::table('jobs')->count(), 0, report: false);
        $failed = (int) rescue(fn () => DB::table('failed_jobs')->count(), 0, report: false);
        $oldest = rescue(fn () => DB::table('jobs')->min('available_at'), null, report: false);
        $oldestSeconds = $oldest !== null ? max(0, time() - (int) $oldest) : null;

        $status = 'ok';
        if ($oldestSeconds !== null && $oldestSeconds > self::QUEUE_STUCK_SECONDS) {
            $status = 'down'; // a job has waited past a normal drain → worker stalled
        } elseif ($failed > 0 || $pending > 500) {
            $status = 'warn';
        }

        return ['pending' => $pending, 'failed' => $failed, 'oldest_pending_seconds' => $oldestSeconds, 'status' => $status];
    }

    /**
     * The scheduler writes a heartbeat every minute; a stale (or missing) one means
     * the ticker container is down — so nothing scheduled (queue drain, backfill,
     * expiry) is running.
     *
     * @return array{last_run_at: string|null, seconds_since: int|null, status: string}
     */
    private function scheduler(): array
    {
        $last = rescue(fn () => Cache::get(self::HEARTBEAT_KEY), null, report: false);
        $at = is_string($last) && $last !== '' ? rescue(fn () => CarbonImmutable::parse($last), null, report: false) : null;
        $seconds = $at !== null ? max(0, (int) CarbonImmutable::now()->diffInSeconds($at)) : null;
        $status = $seconds !== null && $seconds < self::SCHEDULER_STALE_SECONDS ? 'ok' : 'down';

        return ['last_run_at' => $at?->toIso8601String(), 'seconds_since' => $seconds, 'status' => $status];
    }

    /** True when a TCP connection to the service opens within the timeout. */
    private function tcpReachable(string $host, int $port): bool
    {
        $conn = @fsockopen($host, $port, $errno, $errstr, 2.0);
        if ($conn === false) {
            return false;
        }
        fclose($conn);

        return true;
    }

    /** True when the URL answers with ANY HTTP status (reachable), within 2s. */
    private function httpReachable(string $url): bool
    {
        if ($url === '') {
            return false;
        }

        return (bool) rescue(
            fn () => Http::withOptions(self::NO_PROXY)->timeout(2)->get($url)->status() > 0,
            false,
            report: false,
        );
    }

    private function reverbHost(): string
    {
        return (string) (config('broadcasting.connections.reverb.options.host') ?: 'reverb');
    }

    private function reverbPort(): int
    {
        return (int) (config('broadcasting.connections.reverb.options.port') ?: 8080);
    }
}
