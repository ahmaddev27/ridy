<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
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

    /** Retry every failed job (pushes them back onto the queue). */
    public function retry(): JsonResponse
    {
        $count = DB::table('failed_jobs')->count();
        Artisan::call('queue:retry', ['id' => ['all']]);

        return response()->json(['data' => ['retried' => $count]]);
    }

    /** Delete every failed job (they are gone for good). */
    public function flush(): JsonResponse
    {
        $count = DB::table('failed_jobs')->count();
        Artisan::call('queue:flush');

        return response()->json(['data' => ['cleared' => $count]]);
    }

    /** Delete the PENDING backlog (jobs waiting to run) — a hard reset. */
    public function clearPending(): JsonResponse
    {
        $count = DB::table('jobs')->count();
        DB::table('jobs')->delete();

        return response()->json(['data' => ['cleared' => $count]]);
    }
}
