<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use SplFileObject;

/**
 * Super-admin log viewer for the System Health board: tail and clear the backend
 * (Laravel) log and the frontend client-error log, so the admin can watch and reset
 * the system's diagnostics from the dashboard. The frontend log is fed by
 * {@see recordFrontend()}, which the dashboard posts its client-side errors to.
 */
class LogViewerController extends Controller
{
    private const MAX_FRONTEND_BYTES = 2_000_000;

    /** Absolute path of a known log source, or null for an unknown source. */
    private function path(string $source): ?string
    {
        return match ($source) {
            'backend' => storage_path('logs/laravel.log'),
            'frontend' => storage_path('logs/frontend.log'),
            default => null,
        };
    }

    /** Tail of a log source (most recent lines last). */
    public function index(Request $request): JsonResponse
    {
        $source = $request->string('source', 'backend')->toString();
        $lines = min(2000, max(50, (int) $request->integer('lines', 300)));
        $path = $this->path($source);

        if ($path === null || ! is_file($path) || ! is_readable($path)) {
            return response()->json(['data' => ['source' => $source, 'lines' => [], 'bytes' => 0]]);
        }

        return response()->json(['data' => [
            'source' => $source,
            'bytes' => (int) filesize($path),
            'lines' => $this->tail($path, $lines),
        ]]);
    }

    /** Truncate a log source. */
    public function clear(Request $request): JsonResponse
    {
        $path = $this->path($request->string('source', 'backend')->toString());
        if ($path !== null && is_file($path) && is_writable($path)) {
            file_put_contents($path, '');
        }

        return response()->json(['data' => ['cleared' => true]]);
    }

    /**
     * Append one client-side error line to the frontend log. Called by the dashboard's
     * global error reporter — authenticated but not admin-only, since errors happen for
     * any dashboard user. Throttled + size-capped so it can't be abused into a huge file.
     */
    public function recordFrontend(Request $request): JsonResponse
    {
        $data = $request->validate([
            'message' => ['required', 'string', 'max:2000'],
            'level' => ['nullable', 'string', 'max:20'],
            'url' => ['nullable', 'string', 'max:500'],
        ]);

        $line = sprintf(
            "[%s] %s %s — %s\n",
            now()->toDateTimeString(),
            strtoupper($data['level'] ?? 'error'),
            $data['url'] ?? '-',
            str_replace(["\n", "\r"], ' ', $data['message']),
        );

        $path = storage_path('logs/frontend.log');
        // Reset the file if it has grown past the cap, so it can never run away.
        if (is_file($path) && filesize($path) > self::MAX_FRONTEND_BYTES) {
            file_put_contents($path, '');
        }
        @file_put_contents($path, $line, FILE_APPEND | LOCK_EX);

        return response()->json(['data' => ['logged' => true]]);
    }

    /**
     * The last $lines lines of a file, read from the end. SplFileObject seeks to the
     * line count first, then reads only the tail — cheap even for a large log.
     *
     * @return array<int, string>
     */
    private function tail(string $path, int $lines): array
    {
        $file = new SplFileObject($path, 'r');
        $file->seek(PHP_INT_MAX);
        $lastLine = $file->key();
        $start = max(0, $lastLine - $lines);

        $out = [];
        $file->seek($start);
        while (! $file->eof()) {
            $line = rtrim((string) $file->fgets(), "\r\n");
            if ($line !== '') {
                $out[] = $line;
            }
        }

        return $out;
    }
}
