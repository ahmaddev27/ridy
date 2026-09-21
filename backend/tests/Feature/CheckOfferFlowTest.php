<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The offer-flow stall detector (observability): flags a served company whose
 * status sync is live and has idle online drivers, yet no offers are arriving —
 * the shape of a silently-stalled RAMEN stream.
 */
class CheckOfferFlowTest extends TestCase
{
    use RefreshDatabase;

    private function servedTenant(string $name): Tenant
    {
        $tenant = Tenant::create([
            'name' => $name, 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($tenant->id);

        return $tenant;
    }

    private function driver(Tenant $tenant, string $uuid, string $status, ?\DateTimeInterface $syncedAt): Driver
    {
        return Driver::create([
            'tenant_id' => $tenant->id, 'name' => 'D', 'uber_driver_uuid' => $uuid,
            'online_status' => $status, 'status_synced_at' => $syncedAt,
        ]);
    }

    private function offer(Tenant $tenant, \DateTimeInterface $receivedAt): void
    {
        DispatchOffer::create([
            'tenant_id' => $tenant->id, 'driver_uuid' => 'u', 'offer_uuid' => 'o-'.uniqid(),
            'received_at' => $receivedAt, 'raw_payload' => [],
        ]);
    }

    public function test_flags_idle_online_drivers_with_no_recent_offers(): void
    {
        $t = $this->servedTenant('Stalled');
        $this->driver($t, 'u1', 'MONITORING_SUPPLY_STATUS_ONLINE', now()); // online, idle, fresh sync
        $this->offer($t, now()->subMinutes(40)); // last offer well past the 25-min window

        $this->artisan('fleet:check-offer-flow')->expectsOutputToContain('1 company')->assertSuccessful();
    }

    public function test_does_not_flag_when_offers_are_still_flowing(): void
    {
        $t = $this->servedTenant('Healthy');
        $this->driver($t, 'u1', 'MONITORING_SUPPLY_STATUS_ONLINE', now());
        $this->offer($t, now()->subMinutes(3)); // a recent offer → stream is delivering

        $this->artisan('fleet:check-offer-flow')->expectsOutputToContain('0 company')->assertSuccessful();
    }

    public function test_does_not_flag_when_no_driver_is_online_and_idle(): void
    {
        $t = $this->servedTenant('AllBusy');
        // Engaged and offline drivers won't get new offers — not a stall signal.
        $this->driver($t, 'u1', 'MONITORING_SUPPLY_STATUS_ON_TRIP', now());
        $this->driver($t, 'u2', 'MONITORING_SUPPLY_STATUS_OFFLINE', now());
        $this->offer($t, now()->subMinutes(40));

        $this->artisan('fleet:check-offer-flow')->expectsOutputToContain('0 company')->assertSuccessful();
    }

    public function test_does_not_flag_when_status_sync_is_stale(): void
    {
        // A stale sync means we don't actually know the driver is online now — that
        // is CheckFleetSync's job, so this detector stays quiet to avoid overlap.
        $t = $this->servedTenant('SyncDead');
        $this->driver($t, 'u1', 'MONITORING_SUPPLY_STATUS_ONLINE', now()->subMinutes(30));
        $this->offer($t, now()->subMinutes(40));

        $this->artisan('fleet:check-offer-flow')->expectsOutputToContain('0 company')->assertSuccessful();
    }
}
