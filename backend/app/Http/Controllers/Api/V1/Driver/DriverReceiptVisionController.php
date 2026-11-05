<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Receipts\ReceiptVision;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Live receipt reader: the authoritative analyser of a captured receipt.
 *
 * The photo is read into memory, handed to the vision model and answered in
 * the same response. It is never written to disk, cache, queue payload or
 * database; PHP's own upload temp file is removed at the end of the request.
 * 503 = the vision container is not configured; 502 = it failed. The app
 * shows a retry in both cases and stores nothing.
 */
class DriverReceiptVisionController extends Controller
{
    public function store(Request $request, ReceiptVision $vision): JsonResponse
    {
        $request->validate(['image' => ['required', 'file', 'mimes:jpg,jpeg,png', 'max:4096']]);

        if (! $vision->isConfigured()) {
            return response()->json(['message' => 'Receipt vision is not available.'], 503);
        }

        try {
            $fields = $vision->read((string) $request->file('image')->get());
        } catch (Throwable $e) {
            Log::warning('receipt-vision.failed', ['driver' => $request->user('driver')->id, 'error' => $e->getMessage()]);

            return response()->json(['message' => 'The receipt could not be read.'], 502);
        }

        return response()->json(['data' => ['fields' => $fields]]);
    }
}
