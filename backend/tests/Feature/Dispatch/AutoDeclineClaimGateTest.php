<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\DispatchActionService;
use App\Domain\Dispatch\DispatchCommandQueue;
use App\Domain\Dispatch\DispatchCommandStatus;
use App\Domain\Dispatch\Models\DaemonShard;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\OfferDispatchCommand;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * The execution-time admin gate: an auto-decline queued while the admin allowed the
 * driver must NOT reach the daemon if the admin revokes before it is claimed — the
 * residual window PR #313 left open.
 */
class AutoDeclineClaimGateTest extends TestCase
{
    use RefreshDatabase;

    private object $spy;

    private Tenant $tenant;

    private Driver $driver;

    private DaemonShard $shard;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
        Queue::fake();

        $this->spy = new class implements PushSender
        {
            public array $tokens = [];

            public function send(string $deviceToken, string $title, string $body, array $data = []): bool
            {
                $this->tokens[] = $deviceToken;

                return true;
            }
        };
        $this->app->instance(PushSender::class, $this->spy);

        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        $this->tenant->setDispatchRejectEnabled(true);
        app(TenantContext::class)->set($this->tenant->id);
        $this->shard = DaemonShard::create(['name' => 'main', 'active' => true, 'last_seen_at' => now()]);
        $session = UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => 'org-1',
            'cookies' => [['name' => 'a', 'value' => 'b']], 'status' => UberFleetSession::STATUS_ACTIVE,
        ]);
        $session->forceFill(['shard_id' => $this->shard->id])->save();
        $this->driver = Driver::create(['name' => 'Mhmoud', 'uber_driver_uuid' => 'drv-1', 'auto_decline' => [
            'admin_enabled' => true, 'enabled' => true,
        ]]);
        DeviceToken::create(['driver_id' => $this->driver->id, 'token' => 'phone', 'tenant_id' => $this->tenant->id]);
    }

    public function test_a_revoke_between_queue_and_claim_blocks_the_decline_and_sends_the_push(): void
    {
        $command = $this->queueAutoDecline();
        $this->assertTrue($command->is_auto);

        // The admin revokes AFTER the command was queued, via a separate write.
        Driver::whereKey($this->driver->id)->update(['auto_decline' => json_encode(['admin_enabled' => false, 'enabled' => true])]);

        $claimed = app(DispatchCommandQueue::class)->claimForShard($this->shard);

        $this->assertCount(0, $claimed, 'no decline may reach the daemon for a revoked driver');
        $this->assertSame(DispatchCommandStatus::Expired, $command->fresh()->status);
        $this->assertSame(['phone'], $this->spy->tokens, 'the normal push still goes out');
    }

    public function test_the_company_kill_switch_between_queue_and_claim_also_blocks(): void
    {
        $command = $this->queueAutoDecline();
        $this->tenant->setDispatchRejectEnabled(false);

        $this->assertCount(0, app(DispatchCommandQueue::class)->claimForShard($this->shard));
        $this->assertSame(DispatchCommandStatus::Expired, $command->fresh()->status);
    }

    public function test_a_still_permitted_auto_decline_is_claimed_normally(): void
    {
        $this->queueAutoDecline();

        $this->assertCount(1, app(DispatchCommandQueue::class)->claimForShard($this->shard));
        $this->assertSame([], $this->spy->tokens);
    }

    public function test_a_manual_decline_is_not_subject_to_the_auto_gate(): void
    {
        $command = $this->queueAutoDecline(auto: false);
        Driver::whereKey($this->driver->id)->update(['auto_decline' => json_encode(['admin_enabled' => false])]);

        $this->assertCount(1, app(DispatchCommandQueue::class)->claimForShard($this->shard));
        $this->assertSame(DispatchCommandStatus::Claimed, $command->fresh()->status);
    }

    private function queueAutoDecline(bool $auto = true): OfferDispatchCommand
    {
        $offer = DispatchOffer::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id,
            'driver_id' => $this->driver->id,
            'driver_uuid' => 'drv-1',
            'offer_uuid' => 'o-1',
            'real_offer_uuid' => 'real-1',
            'pickup_address' => 'Königswall 15, 44137 Dortmund',
            'dropoff_address' => 'Bunsen-Kirchhoff-Straße 11, 44139 Dortmund',
            'fare_formatted' => '€7.41',
            'fare_amount' => 7.41,
            'accept_window_seconds' => 5,
            'received_at' => now(),
            'offer_generated_at' => now(),
            'status' => OfferStatus::Pending,
            'raw_payload' => [],
        ]);
        if ($auto) {
            $offer->forceFill(['auto_decline_reason' => 'min_fare'])->save();
        }

        $result = app(DispatchActionService::class)->requestReject($offer, $this->driver, auto: $auto);
        $this->assertSame('queued', $result['status']);

        return OfferDispatchCommand::withoutGlobalScopes()->findOrFail($result['command_id']);
    }
}
