<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Audit\AuditLogger;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/**
 * Super-admin queue management for the System Health board: inspect failed jobs and
 * act on them — retry all (push back onto the queue), clear the failed list, or clear
 * the pending backlog. Lets the admin recover the queue from the dashboard instead of
 * shelling into the server.
 */
class QueueAdminController extends Controller
{
    /** Recent failed jobs, parsed to a compact shape (name + first error line). */
    public function failed(): JsonResponse
    {
        $rows = DB::table('failed_jobs')->orderByDesc('failed_at')->limit(50)->get();

        $jobs = $rows->map(function ($r) {
            $payload = json_decode((string) $r->payload, true) ?: [];
            $name = $payload['displayName'] ?? ($payload['job'] ?? 'job');
            // First line of the stack trace is the exception class + message.
            $exception = trim(strtok((string) $r->exception, "\n") ?: '');

            return [
                'id' => (int) $r->id,
                'uuid' => $r->uuid,
                'queue' => $r->queue,
                'name' => class_basename((string) $name),
                'exception' => mb_substr($exception, 0, 300),
                'failed_at' => $r->failed_at,
            ];
        });

        // Failure counts grouped by job class — surfaces the dominant failure fast.
        $byName = $jobs->countBy('name')->sortDesc()->take(6)
            ->map(fn ($count, $name) => ['name' => $name, 'count' => $count])
            ->values();

        return response()->json(['data' => [
            'total' => DB::table('failed_jobs')->count(),
            'pending' => DB::table('jobs')->count(),
            'by_name' => $byName,
            'jobs' => $jobs,
        ]]);
    }

    /**
     * Retry failed jobs (pushes them back onto the queue): every one by default
     * (the existing dashboard button), or only the given `ids` (uuids) or job
     * class `name` (e.g. "GeocodeOffer").
     */
    public function retry(Request $request, AuditLogger $audit): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['sometimes', 'array', 'max:500'],
            'ids.*' => ['string', 'max:64'],
            'name' => ['sometimes', 'string', 'max:120'],
        ]);

        $uuids = $this->selectFailedUuids($data['ids'] ?? null, $data['name'] ?? null);
        if ($uuids !== []) {
            Artisan::call('queue:retry', ['id' => $uuids]);
        }

        $audit->logPlatform('queue.retry', null, [
            'count' => count($uuids),
            'filter' => array_filter(['name' => $data['name'] ?? null, 'ids' => isset($data['ids']) ? count($data['ids']) : null]),
        ]);

        return response()->json(['data' => ['retried' => count($uuids)]]);
    }

    /** Delete every failed job (they are gone for good). */
    public function flush(AuditLogger $audit): JsonResponse
    {
        $count = DB::table('failed_jobs')->count();
        Artisan::call('queue:flush');
        $audit->logPlatform('queue.flush', null, ['count' => $count]);

        return response()->json(['data' => ['cleared' => $count]]);
    }

    /** Delete the PENDING backlog (jobs waiting to run) — a hard reset. */
    public function clearPending(AuditLogger $audit): JsonResponse
    {
        $count = DB::table('jobs')->count();
        DB::table('jobs')->delete();
        $audit->logPlatform('queue.clear_pending', null, ['count' => $count]);

        return response()->json(['data' => ['cleared' => $count]]);
    }

    /**
     * @param  array<int, string>|null  $ids
     * @return array<int, string> failed-job uuids to retry
     */
    private function selectFailedUuids(?array $ids, ?string $name): array
    {
        $query = DB::table('failed_jobs');
        if ($ids !== null) {
            $query->whereIn('uuid', $ids);
        }

        $rows = $query->get(['uuid', 'payload']);
        if ($name !== null) {
            $rows = $rows->filter(function ($row) use ($name) {
                $payload = json_decode((string) $row->payload, true) ?: [];

                return class_basename((string) ($payload['displayName'] ?? '')) === $name;
            });
        }

        return $rows->pluck('uuid')->filter()->values()->all();
    }
}
