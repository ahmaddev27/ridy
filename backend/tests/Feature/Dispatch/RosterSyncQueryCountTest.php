<?php

namespace Tests\Feature\Dispatch;

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
