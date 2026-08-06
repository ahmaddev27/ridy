<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\DispatchOfferIngestor;
use App\Domain\Tenancy\Models\Tenant;
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
            // The offer's own partnerUUID identifies the fleet, so the daemon
            // never has to know internal tenant ids.
            $partnerUuid = (string) Arr::get($offer, 'partnerUUID', '');
            $tenant = $partnerUuid !== ''
                ? Tenant::where('uber_org_uuid', $partnerUuid)->first()
                : null;

            if ($tenant === null) {
                $results['no_tenant']++;

                continue;
            }

            $outcome = $ingestor->ingest($tenant->id, $offer, $seq);
            $results[$outcome['status']] = ($results[$outcome['status']] ?? 0) + 1;
        }

        return response()->json(['data' => $results]);
    }
}
