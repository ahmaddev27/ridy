<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\SubmissionRecorder;
use App\Domain\Receipts\ReceiptVision;
use App\Domain\Receipts\ReceiptVisionJobs;
use App\Http\Controllers\Controller;
use App\Jobs\ProcessReceiptVision;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
    public function store(Request $request, SubmissionRecorder $recorder): JsonResponse
    {
        $user = $this->owner($request);
        if (! ($user->tenant?->isElprofessorConnected() ?? false)) {
            return $this->notConnected();
        }

        $driver = $this->driverOf($request, $user);
        // Zero image storage on this path: the photo is analysed through
        // `visionStart` (parsed, then deleted) and only the figures are filed.
        // A `document` sent anyway is ignored (storePhoto: false).
        $request->merge(['subject' => 'receipt']);
        [$subject, $data] = $recorder->validate($request);
        $row = $recorder->record($driver, $subject, $data, $request, storePhoto: false);

        return response()->json([
            'data' => ['id' => $row->uuid, 'subject' => $row->subject, 'status' => $row->status],
        ], 201);
    }

    public function visionStart(Request $request, ReceiptVision $vision, ReceiptVisionJobs $jobs): JsonResponse
    {
        $user = $this->owner($request);
        $request->validate(['image' => ['required', 'file', 'mimes:jpg,jpeg,png', 'max:4096']]);
        $driver = $this->driverOf($request, $user);

        if (! $vision->isConfigured()) {
            return response()->json(['message' => 'Receipt vision is not available.'], 503);
        }

        $id = $jobs->begin($driver->id, (string) $request->file('image')->get());
        ProcessReceiptVision::dispatch($driver->id, $id);

        return response()->json(['data' => ['id' => $id, 'status' => 'pending']], 202);
    }

    public function visionShow(Request $request, ReceiptVisionJobs $jobs, string $id): JsonResponse
    {
        $driver = $this->driverOf($request, $this->owner($request));
        $state = $jobs->status($driver->id, $id);

        return $state === null
            ? response()->json(['message' => 'Unknown or expired.'], 404)
            : response()->json(['data' => $state]);
    }

    private function owner(Request $request): User
    {
        $user = $request->user();
        abort_unless($user instanceof User && $user->tenant_id !== null, 403, 'fleet_owner_only');

        return $user;
    }

    /** The picked driver, only if they belong to the caller's company. */
    private function driverOf(Request $request, User $user): Driver
    {
        $id = $request->validate(['driver_id' => ['required', 'integer']])['driver_id'];

        return Driver::withoutGlobalScopes()
            ->where('tenant_id', $user->tenant_id)
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
