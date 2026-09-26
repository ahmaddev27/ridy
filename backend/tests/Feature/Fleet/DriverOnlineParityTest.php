<?php

namespace Tests\Feature\Fleet;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Divergence guard: the `is_online` / `engagement` generated columns are a SQL
 * transcription of Driver::statusIsOnline() / engagementStatus(). If either side
 * drifts — a new OFFLINE token in PHP, or an edited CASE in the migration — the two
 * disagree on some status and this fails. It runs on the actual test DB (SQLite here,
 * MySQL in prod), so it proves the columns compute the canonical verdict on both.
 */
class DriverOnlineParityTest extends TestCase
{
    use RefreshDatabase;

    /** Representative statuses: empties, every offline token, plain-online, and both engagement tokens (incl. embedded). */
    private const STATUSES = [
        null, '', ' ', 'OFFLINE', 'STATUS_UNAVAILABLE', 'DISCONNECTED', 'off_duty', 'LOGGED_OUT',
        'ONLINE', 'DRIVER_ONLINE', 'EN_ROUTE', 'ON_TRIP', 'ONLINE_EN_ROUTE', 'x_ON_TRIP_y',
    ];

    public function test_generated_columns_match_the_php_canonical_logic(): void
    {
        $tenant = Tenant::create([
            'name' => 'Parity', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($tenant->id);

        foreach (self::STATUSES as $status) {
            $driver = Driver::create([
                'tenant_id' => $tenant->id, 'name' => 'D', 'online_status' => $status,
            ]);

            // The columns are computed by the DB, not in memory — re-fetch to read them.
            $fresh = Driver::withoutGlobalScopes()->findOrFail($driver->id);
            $label = 'status='.var_export($status, true);

            $scopeSaysOnline = Driver::withoutGlobalScopes()->online()->whereKey($driver->id)->exists();
            $this->assertSame(Driver::statusIsOnline($status), $scopeSaysOnline, "scopeOnline vs statusIsOnline for {$label}");
            $this->assertSame(Driver::statusIsOnline($status), $fresh->is_online, "is_online column vs statusIsOnline for {$label}");
            $this->assertSame($driver->engagementStatus(), $fresh->engagement, "engagement column vs engagementStatus() for {$label}");
        }
    }

    public function test_live_first_order_agrees_with_the_canonical_online_and_engagement_logic(): void
    {
        $tenant = Tenant::create(['name' => 'Order', 'country' => 'DE']);
        app(TenantContext::class)->set($tenant->id);

        // An online status WITHOUT the literal "ONLINE" must sort with the online
        // drivers (the old LIKE '%ONLINE%' CASE put it among the offline ones).
        foreach (['OFFLINE' => 'a-off', 'DRIVER_AVAILABLE' => 'b-avail', 'ON_TRIP' => 'c-trip', 'EN_ROUTE' => 'd-route'] as $status => $name) {
            Driver::create(['tenant_id' => $tenant->id, 'name' => $name, 'online_status' => $status]);
        }

        $this->assertSame(['c-trip', 'd-route', 'b-avail', 'a-off'], Driver::query()->liveFirst()->pluck('name')->all());
    }
}
