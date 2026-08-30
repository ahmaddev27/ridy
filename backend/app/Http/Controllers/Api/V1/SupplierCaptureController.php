<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\SupplierNetworkRecorder;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A generic sink for any supplier (Uber Fleet) page the extension pulls but that
 * has no dedicated ingest endpoint yet — Documents, Reports, Invoices, Banking,
 * Promotions, Inbox, … The extension fetches the tab with the manager's own
 * session and POSTs the raw payload here tagged with a `kind`, so it shows up in
 * the admin Network feed immediately. Dedicated storage/models can be added per
 * source later; this makes every Uber action visible first.
 */
class SupplierCaptureController extends Controller
{
    public function store(Request $request, SupplierNetworkRecorder $recorder): JsonResponse
    {
        $data = $request->validate([
            'kind' => ['required', 'string', 'max:20'],
            'summary' => ['nullable', 'string', 'max:250'],
            'count' => ['nullable', 'integer'],
            'payload' => ['required'],
        ]);

        $recorder->capture(
            (int) $request->user()->tenant_id,
            $data['kind'],
            $data['payload'],
            $data['summary'] ?? null,
            $data['count'] ?? null,
        );

        return response()->json(['data' => ['captured' => true]]);
    }
}
