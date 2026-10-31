<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Receipts\ReceiptVision;
use App\Domain\Receipts\ReceiptVisionJobs;
use App\Http\Controllers\Controller;
use App\Jobs\ProcessReceiptVision;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Fallback reader for receipts the phone's own OCR could not read.
 *
 * `store` accepts the photo and acks immediately (202 + id); the model runs in
 * a queued job; `show` is polled for the result. The photo never persists past
 * the parse. 503 when the vision container is not configured - the app then
 * just keeps its on-device result.
 */
class DriverReceiptVisionController extends Controller
{
    public function store(Request $request, ReceiptVision $vision, ReceiptVisionJobs $jobs): JsonResponse
    {
        $request->validate(['image' => ['required', 'file', 'mimes:jpg,jpeg,png', 'max:4096']]);

        if (! $vision->isConfigured()) {
            return response()->json(['message' => 'Receipt vision is not available.'], 503);
        }

        $driverId = (int) $request->user('driver')->id;
        $id = $jobs->begin($driverId, (string) $request->file('image')->get());
        ProcessReceiptVision::dispatch($driverId, $id);

        return response()->json(['data' => ['id' => $id, 'status' => 'pending']], 202);
    }

    public function show(Request $request, ReceiptVisionJobs $jobs, string $id): JsonResponse
    {
        $state = $jobs->status((int) $request->user('driver')->id, $id);

        return $state === null
            ? response()->json(['message' => 'Unknown or expired.'], 404)
            : response()->json(['data' => $state]);
    }
}
