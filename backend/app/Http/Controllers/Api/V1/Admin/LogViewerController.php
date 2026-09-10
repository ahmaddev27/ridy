<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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

        // Strip control characters from ALL THREE fields. Sanitising only the message
        // let any signed-in dashboard user put newlines in `url` or `level` and forge
        // arbitrary extra lines in the admin's frontend log — including lines that
        // read like backend errors.
        $line = sprintf(
            "[%s] %s %s — %s\n",
            now()->toDateTimeString(),
            strtoupper(self::oneLine($data['level'] ?? 'error')),
            self::oneLine($data['url'] ?? '-'),
            self::oneLine($data['message']),
        );

        $path = storage_path('logs/frontend.log');
        // Reset the file if it has grown past the cap, so it can never run away.
        if (is_file($path) && filesize($path) > self::MAX_FRONTEND_BYTES) {
            file_put_contents($path, '');
        }
        @file_put_contents($path, $line, FILE_APPEND | LOCK_EX);

        return response()->json(['data' => ['logged' => true]]);
    }

    /** Collapse a user-supplied value to a single log-safe line. */
    private static function oneLine(string $value): string
    {
        return trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value) ?? '');
    }

    /**
     * The last $lines lines of a file, read backwards from the end in fixed blocks.
     *
     * The previous implementation seek(PHP_INT_MAX)'d an SplFileObject to find the
     * last key and then seek()'d back — two full passes over the file per call. On a
     * laravel.log of a few hundred MB (it is only truncated manually) that ran on
     * every load of the admin System Health page.
     *
     * @return array<int, string>
     */
    private function tail(string $path, int $lines): array
    {
        $handle = fopen($path, 'rb');
        if ($handle === false) {
            return [];
        }

        $block = 8192;
        $position = filesize($path) ?: 0;
        $buffer = '';

        try {
            // Walk backwards a block at a time until we hold enough newlines (one
            // more than requested, so the first line in the buffer is known-complete).
            while ($position > 0 && substr_count($buffer, "\n") <= $lines) {
                $read = (int) min($block, $position);
                $position -= $read;
                fseek($handle, $position);
                $buffer = (string) fread($handle, $read).$buffer;
            }
        } finally {
            fclose($handle);
        }

        $parts = preg_split('/\r\n|\n|\r/', $buffer) ?: [];
        // A log file ends with a newline, so the split leaves one empty tail element;
        // dropping it keeps "last 200 lines" from silently returning 199.
        if (end($parts) === '') {
            array_pop($parts);
        }

        $out = [];
        foreach (array_slice($parts, -$lines) as $line) {
            if ($line !== '') {
                $out[] = $line;
            }
        }

        return $out;
    }
}
