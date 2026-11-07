<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\SubmissionRecorder;
use App\Domain\Receipts\ReceiptVision;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Api\V1\Driver\Concerns\ResolvesFleetTenant;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * A company manager/owner files a Beleg FOR one of their own drivers.
 *
 * Mirrors the driver's `POST submissions` + `receipt-vision`, and reuses their
 * code: the wire rules and the persist live in {@see SubmissionRecorder}, the
 * reader in {@see ReceiptVision}. The submission lands exactly like the
 * driver's own (pending, rung to El-Professor, attributed to that driver), so
 * the company's review and the driver's archive need no special case.
 *
 * ## Who may file for whom
 *
 * The route group already guarantees a tenant-bound owner/manager (`fleet.owner`).
 * The driver is then a TERM IN THE QUERY (`tenant_id` = the caller's), so a
 * driver of another company and an id that does not exist are the same missing
 * row: one 404 by construction. Receipts only; a note is the driver's own
 * report of what happened to them and stays theirs.
 *
 * ## Same wall as the driver's
 *
 * The company must be connected to El-Professor, or nobody would fetch what is
 * stored: 403 `not_connected`, the stable reason the app already renders.
 */
class FleetReceiptController extends Controller
{
    use ResolvesFleetTenant;

    public function store(Request $request, SubmissionRecorder $recorder): JsonResponse
    {
        $tenantId = $this->fleetTenantId($request);
        if (! (Tenant::find($tenantId)?->isElprofessorConnected() ?? false)) {
            return $this->notConnected();
        }

        $driver = $this->driverOf($request, $tenantId);
        // Zero image storage: the photo is analysed in memory by `vision` and
        // only the figures are filed; a `document` sent anyway is dropped.
        $request->merge(['subject' => 'receipt']);
        [$subject, $data] = $recorder->validate($request);
        $row = $recorder->record($driver, $subject, $data, $request);

        return response()->json([
            'data' => ['id' => $row->uuid, 'subject' => $row->subject, 'status' => $row->status],
        ], 201);
    }

    /**
     * Synchronous and no-store, exactly like the driver's `receipt-vision`: the
     * photo is read into memory, parsed and answered in this response.
     */
    public function vision(Request $request, ReceiptVision $vision): JsonResponse
    {
        $tenantId = $this->fleetTenantId($request);
        $request->validate(['image' => ['required', 'file', 'mimes:jpg,jpeg,png', 'max:4096']]);
        $driver = $this->driverOf($request, $tenantId);

        if (! $vision->isConfigured()) {
            return response()->json(['message' => 'Receipt vision is not available.'], 503);
        }

        try {
            $fields = $vision->read((string) $request->file('image')->get());
        } catch (Throwable $e) {
            Log::warning('receipt-vision.failed', ['driver' => $driver->id, 'error' => $e->getMessage()]);

            return response()->json(['message' => 'The receipt could not be read.'], 502);
        }

        return response()->json(['data' => ['fields' => $fields]]);
    }

    /** The picked driver, only if they belong to the caller's company. */
    private function driverOf(Request $request, int $tenantId): Driver
    {
        $id = $request->validate(['driver_id' => ['required', 'integer']])['driver_id'];

        return Driver::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->findOrFail($id);
    }

    private function notConnected(): JsonResponse
    {
        return response()->json([
            'message' => 'This company is not connected to El-Professor.',
            'reason' => 'not_connected',
        ], 403);
    }
}
