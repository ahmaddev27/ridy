<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\DispatchOfferIngestor;
use App\Domain\Dispatch\LockRetry;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\SupplierNetworkRecorder;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\IngestOffersRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Receives raw offers forwarded by the dispatch daemon and hands each to the
 * ingestor. The daemon stays a dumb pipe; all routing/dedup lives here.
 */
class DispatchIngestController extends Controller
{
    public function ingest(IngestOffersRequest $request, DispatchOfferIngestor $ingestor, SupplierNetworkRecorder $recorder): JsonResponse
    {
        $data = $request->validated();

        $seq = $data['seq'] ?? null;
        $results = ['routed' => 0, 'unlinked_driver' => 0, 'duplicate' => 0, 'skipped_no_uuid' => 0, 'no_tenant' => 0, 'error' => 0];

        // ONE pre-push geocode budget for the whole batch: a second offer in the
        // same message must never wait out a fresh budget behind the first.
        $deadline = DispatchOfferIngestor::batchDeadline();
        $retryable = false;

        foreach ($data['offers'] as $offer) {
            // Route by the ACTIVE session for this Uber org, not the tenant's
            // stored uber_org_uuid — a disconnected company keeps that column but
            // must never receive offers again, and one-account-per-company means
            // exactly one session owns the org. This prevents an offer streamed by
            // the connected company from being attributed to a since-disconnected
            // tenant that once linked the same account.
            $partnerUuid = Arr::get($offer, 'partnerUUID');
            $partnerUuid = is_scalar($partnerUuid) ? (string) $partnerUuid : '';

            try {
                $session = $partnerUuid !== ''
                    ? UberFleetSession::withoutGlobalScopes()->where('uber_org_uuid', $partnerUuid)->first()
                    : null;

                if ($session === null) {
                    $results['no_tenant']++;

                    continue;
                }

                $tenantId = (int) $session->tenant_id;

                // Capture the RAW offer for the admin Network feed first — before
                // ingestion/geocoding/normalisation — so it shows exactly as it
                // arrived. Best-effort: the debug feed must never block a push.
                rescue(fn () => $recorder->offer($tenantId, $offer));

                $outcome = $ingestor->ingest($tenantId, $offer, $seq, $deadline);
                $results[$outcome['status']] = ($results[$outcome['status']] ?? 0) + 1;
            } catch (Throwable $e) {
                // One failing offer never stops the rest of the batch.
                $results['error']++;
                $retryable = $retryable || LockRetry::isTransient($e);
                report($e);
                Log::error('dispatch_offer.ingest_error', [
                    'offer_uuid' => is_scalar($offer['offerUUID'] ?? null) ? $offer['offerUUID'] : null,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // A transient DB failure (lost connection, deadlock) is worth the daemon's
        // retry of the whole message: ingest is idempotent on offer_uuid, so offers
        // this attempt already stored come back as `duplicate` with no second push.
        // A deterministic failure (bad payload) stays a 200, or the daemon would
        // retry it for minutes and hold up that driver's later offers.
        if ($retryable) {
            return response()->json(['data' => $results], 503, ['Retry-After' => '1']);
        }

        return response()->json(['data' => $results]);
    }
}
