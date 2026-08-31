<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Dispatch\TimelineReconciler;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TimelineReconcilerTest extends TestCase
{
    use RefreshDatabase;

    public function test_an_assigned_trip_flips_the_matching_offer_from_not_taken_to_accepted(): void
    {
        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        app(TenantContext::class)->set($tenant->id);

        // An offer the coarse poll left wrongly "rejected" (not taken).
        $received = now()->subMinutes(2);
        $offer = DispatchOffer::create([
            'tenant_id' => $tenant->id, 'driver_uuid' => 'd1', 'offer_uuid' => 'o1',
            'pickup_address' => 'A', 'dropoff_address' => 'B', 'received_at' => $received,
            'status' => OfferStatus::Rejected, 'rejected_at' => now(), 'raw_payload' => ['offerUUID' => 'o1'],
        ]);

        // Uber's timeline: a trip was assigned ~30s after the offer arrived.
        $events = [[
            'timestamp' => $received->copy()->addSeconds(30)->getTimestampMs(),
            'status' => 'ONLINE',
            'jobuuid' => '6403d093-19b5-4068-81f2-3513dd761f09',
            'stateChange' => [
                ['type' => 'DJ_ASSIGNED', 'timestamp' => $received->copy()->addSeconds(30)->getTimestampMs(), 'offeruuid' => null],
            ],
        ]];

        $n = app(TimelineReconciler::class)->reconcile($tenant->id, 'd1', $events);

        $this->assertSame(1, $n);
        $this->assertNotNull($offer->fresh()->accepted_at);
        $this->assertSame(OfferStatus::Accepted, $offer->fresh()->status);

        // Idempotent: re-running doesn't re-accept (already has accepted_at).
        $this->assertSame(0, app(TimelineReconciler::class)->reconcile($tenant->id, 'd1', $events));
    }

    public function test_an_online_event_with_no_assignment_changes_nothing(): void
    {
        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        app(TenantContext::class)->set($tenant->id);

        $offer = DispatchOffer::create([
            'tenant_id' => $tenant->id, 'driver_uuid' => 'd1', 'offer_uuid' => 'o2',
            'pickup_address' => 'A', 'dropoff_address' => 'B', 'received_at' => now()->subMinute(),
            'status' => OfferStatus::Rejected, 'rejected_at' => now(), 'raw_payload' => ['offerUUID' => 'o2'],
        ]);

        $events = [['timestamp' => now()->getTimestampMs(), 'status' => 'ONLINE', 'jobuuid' => '', 'stateChange' => null]];

        $this->assertSame(0, app(TimelineReconciler::class)->reconcile($tenant->id, 'd1', $events));
        $this->assertNull($offer->fresh()->accepted_at);
    }
}
