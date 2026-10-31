<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\DispatchActionService;
use App\Domain\Dispatch\DispatchCommandQueue;
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
 * The safety net under auto-decline: the push is suppressed when the decline is
 * QUEUED, so a decline that then fails or expires must hand the offer back to the
 * driver with a belated push — never leave it un-declined AND un-notified.
 */
class AutoDeclineFallbackTest extends TestCase
{
    use RefreshDatabase;

    private object $spy;

    private Tenant $tenant;

    private Driver $driver;

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
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => 'org-1',
            'cookies' => [['name' => 'a', 'value' => 'b']], 'status' => UberFleetSession::STATUS_ACTIVE,
        ]);
        $this->driver = Driver::create(['name' => 'Mhmoud', 'uber_driver_uuid' => 'drv-1']);
        DeviceToken::create(['driver_id' => $this->driver->id, 'token' => 'phone', 'tenant_id' => $this->tenant->id]);
    }

    public function test_a_failed_auto_decline_pushes_the_offer_belatedly_exactly_once(): void
    {
        $command = $this->autoDeclinedCommand();

        app(DispatchActionService::class)->applyResult($command, false, 'offer already expired');
        $this->assertSame(['phone'], $this->spy->tokens, 'the driver must be told so they can decide manually');

        // A redelivered failure must not ring them a second time.
        app(DispatchActionService::class)->applyResult($command->fresh(), false, 'again');
        $this->assertSame(['phone'], $this->spy->tokens);
        $this->assertNotNull($command->offer->fresh()->auto_decline_failed_at);
    }

    public function test_a_no_verdict_failure_also_pushes(): void
    {
        $command = $this->autoDeclinedCommand();

        app(DispatchActionService::class)->applyResult($command, null, 'daemon timeout');

        $this->assertSame(['phone'], $this->spy->tokens);
    }

    public function test_a_successful_auto_decline_is_never_pushed(): void
    {
        $command = $this->autoDeclinedCommand();

        app(DispatchActionService::class)->applyResult($command, true);

        $this->assertSame([], $this->spy->tokens);
        $offer = $command->offer->fresh();
        $this->assertNotNull($offer->dispatch_rejected_at);
        $this->assertNull($offer->auto_decline_failed_at);
    }

    public function test_an_expired_unsent_auto_decline_pushes_the_offer(): void
    {
        $command = $this->autoDeclinedCommand();
        $command->forceFill(['expires_at' => now()->subMinute()])->save();

        $this->assertSame(1, app(DispatchCommandQueue::class)->expireStale());

        $this->assertSame(['phone'], $this->spy->tokens);
    }

    public function test_a_failed_manual_decline_is_not_pushed(): void
    {
        $command = $this->autoDeclinedCommand(autoReason: null);

        app(DispatchActionService::class)->applyResult($command, false, 'nope');

        $this->assertSame([], $this->spy->tokens, 'the driver already saw a manually declined offer');
    }

    public function test_a_failed_auto_decline_on_an_offer_already_taken_is_not_pushed(): void
    {
        $command = $this->autoDeclinedCommand();
        $command->offer->forceFill(['status' => OfferStatus::Accepted, 'accepted_at' => now()])->save();

        app(DispatchActionService::class)->applyResult($command, false, 'nope');

        $this->assertSame([], $this->spy->tokens);
    }

    private function autoDeclinedCommand(?string $autoReason = 'min_fare'): OfferDispatchCommand
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
        $offer->forceFill(['auto_decline_reason' => $autoReason])->save();

        $result = app(DispatchActionService::class)->requestReject($offer, $this->driver);
        $this->assertSame('queued', $result['status']);

        return OfferDispatchCommand::withoutGlobalScopes()->findOrFail($result['command_id']);
    }
}
