<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\RosterSyncService;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Guards the roster preload against regressing to a per-driver N+1: a re-sync of
 * an all-existing roster must resolve every canonical driver from one grouped
 * query, so the SELECTs against `drivers` stay O(1) instead of O(roster size).
 */
class RosterSyncQueryCountTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create([
            'name' => 'YA', 'country' => 'DE', 'uber_org_uuid' => 'org1',
            'status' => 'active', 'activated_at' => now(),
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    public function test_resyncing_an_existing_roster_does_not_scale_selects_with_driver_count(): void
    {
        $roster = $this->roster(15);
        $service = app(RosterSyncService::class);

        // First sync creates the whole roster.
        $first = $service->sync($this->tenant->id, $roster);
        $this->assertSame(15, $first['created']);
        $this->assertSame(15, $first['synced']);
        $this->assertSame(0, $first['removed']);

        // Second sync of the identical roster: every driver already exists, so
        // the whole loop must be served by the single grouped preload.
        DB::enableQueryLog();
        DB::flushQueryLog();
        $second = $service->sync($this->tenant->id, $roster);
        $selectsAgainstDrivers = collect(DB::getQueryLog())
            ->filter(fn (array $q) => stripos(ltrim($q['query']), 'select') === 0
                && stripos($q['query'], 'drivers') !== false)
            ->count();
        DB::disableQueryLog();

        // Bounded, not proportional to the 15-row roster — this is the N+1 proof.
        $this->assertLessThanOrEqual(3, $selectsAgainstDrivers);

        // Behaviour is unchanged: nothing new, everything re-synced, none removed.
        $this->assertSame(0, $second['created']);
        $this->assertSame(15, $second['synced']);
        $this->assertSame(0, $second['removed']);
        $this->assertSame(15, Driver::withoutGlobalScopes()->count());

        // No per-driver offer backfill UPDATE when no offer is orphaned.
        DB::enableQueryLog();
        DB::flushQueryLog();
        $service->sync($this->tenant->id, $roster);
        $offerUpdates = collect(DB::getQueryLog())
            ->filter(fn (array $q) => stripos(ltrim($q['query']), 'update') === 0 && stripos($q['query'], 'dispatch_offers') !== false)
            ->count();
        DB::disableQueryLog();
        $this->assertSame(0, $offerUpdates);
    }

    public function test_orphan_offers_are_linked_and_the_tenant_context_is_restored(): void
    {
        $roster = $this->roster(3);
        $uuid = $roster[1]['driverUuid']['uuid']['uuid'];
        $offer = DispatchOffer::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'driver_uuid' => $uuid, 'offer_uuid' => 'orphan',
            'received_at' => now(), 'raw_payload' => [],
        ]);
        $context = app(TenantContext::class);
        $context->set(999);

        app(RosterSyncService::class)->sync($this->tenant->id, $roster);

        $this->assertSame(999, $context->get(), 'sync must restore the caller\'s tenant context');
        $driverId = Driver::withoutGlobalScopes()->where('uber_driver_uuid', $uuid)->value('id');
        $this->assertSame($driverId, $offer->fresh()->driver_id);
    }

    public function test_non_scalar_and_non_https_roster_fields_are_dropped(): void
    {
        $row = $this->roster(1)[0] + ['email' => ['x' => 'y'], 'pictureUrl' => 'http://tracker.example/p.png', 'recognitionRating' => 'n/a'];

        app(RosterSyncService::class)->sync($this->tenant->id, [$row]);

        $driver = Driver::withoutGlobalScopes()->first();
        $this->assertNull($driver->uber_email);
        $this->assertNull($driver->uber_picture_url);
        $this->assertNull($driver->uber_rating);
    }

    /**
     * Roster rows in the /api/getDrivers shape the service expects: a nested
     * driverUuid carrying a 36-char UUID, plus name and phone.
     *
     * @return array<int, array<string, mixed>>
     */
    private function roster(int $count): array
    {
        return collect(range(1, $count))
            ->map(fn (int $i) => [
                'driverUuid' => ['uuid' => ['uuid' => (string) Str::uuid()]],
                'name' => ['firstName' => 'Driver', 'lastName' => (string) $i],
                'phoneNumber' => ['countryCode' => '+49', 'number' => '1768'.str_pad((string) $i, 7, '0', STR_PAD_LEFT)],
            ])
            ->all();
    }
}
