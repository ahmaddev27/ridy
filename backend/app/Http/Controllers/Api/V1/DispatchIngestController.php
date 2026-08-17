<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\DispatchOfferIngestor;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;

/**
 * Receives raw offers forwarded by the dispatch daemon and hands each to the
 * ingestor. The daemon stays a dumb pipe; all routing/dedup lives here.
 */
class DispatchIngestController extends Controller
{
    public function ingest(Request $request, DispatchOfferIngestor $ingestor): JsonResponse
    {
        $data = $request->validate([
            'offers' => ['required', 'array'],
            'offers.*' => ['array'],
            'seq' => ['nullable', 'integer'],
        ]);

        $seq = $data['seq'] ?? null;
        $results = ['routed' => 0, 'unlinked_driver' => 0, 'duplicate' => 0, 'skipped_no_uuid' => 0, 'no_tenant' => 0];

        foreach ($data['offers'] as $offer) {
            // Route by the ACTIVE session for this Uber org, not the tenant's
            // stored uber_org_uuid — a disconnected company keeps that column but
            // must never receive offers again, and one-account-per-company means
            // exactly one session owns the org. This prevents an offer streamed by
            // the connected company from being attributed to a since-disconnected
            // tenant that once linked the same account.
            $partnerUuid = (string) Arr::get($offer, 'partnerUUID', '');
            $session = $partnerUuid !== ''
                ? UberFleetSession::withoutGlobalScopes()->where('uber_org_uuid', $partnerUuid)->first()
                : null;

            if ($session === null) {
                $results['no_tenant']++;

                continue;
            }

            $outcome = $ingestor->ingest((int) $session->tenant_id, $offer, $seq);
            $results[$outcome['status']] = ($results[$outcome['status']] ?? 0) + 1;
        }

        return response()->json(['data' => $results]);
    }
}
