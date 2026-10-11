<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\DispatchCommandAction;
use App\Domain\Dispatch\DispatchCommandStatus;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\OfferDispatchCommand;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\DispatchNotifier;
use App\Domain\Notifications\Jobs\SendEnrichedOfferPush;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Mockery;
use Tests\TestCase;

/**
 * The SECOND push for an offer: the one carrying the distance and the €/km.
 *
 * A company that declines from the dispatch panel gets a deliberately BARE first
 * push, so it can go out while the offer is still open. This follow-up is the other
 * half of that trade — and the whole point is that it is withheld when the driver
 * declined, because a decline means the ride never became theirs and following it
 * with its price would be the app arguing with a decision just made.
 */
class EnrichedOfferPushTest extends TestCase
{
    use RefreshDatabase;

    private const DRIVER_UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    private Tenant $tenant;

    private Driver $driver;

    private UberFleetSession $session;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();

        $this->tenant = Tenant::create([
            'name' => 'YA', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        $this->tenant->setDispatchRejectEnabled(true);
        app(TenantContext::class)->set($this->tenant->id);

        $this->session = UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => 'org-1',
            'cookies' => [['name' => 'a', 'value' => 'b']],
            'status' => UberFleetSession::STATUS_ACTIVE,
        ]);

        $this->driver = Driver::create([
            'tenant_id' => $this->tenant->id, 'name' => 'Mhmoud',
            'uber_driver_uuid' => self::DRIVER_UUID, 'email' => 'm@ya.de',
        ]);
    }

    public function test_it_follows_an_offer_the_driver_let_through(): void
    {
        // Nobody declined it, so the ride became the driver's — and the metrics the
        // bare first push deliberately left out are exactly what they now want.
        $this->assertSame(1, $this->pushesSent($this->offer()));
    }

    public function test_it_is_withheld_after_a_confirmed_decline(): void
    {
        $offer = $this->offer();
        $offer->forceFill(['dispatch_rejected_at' => now()])->save();

        $this->assertSame(0, $this->pushesSent($offer));
    }

    public function test_it_is_withheld_while_a_decline_is_still_in_flight(): void
    {
        // The driver tapped, the command is queued or claimed, and Uber has not
        // answered. Pushing trip details in that window would tell the driver they
        // got a ride they declined a second earlier.
        foreach ([DispatchCommandStatus::Queued, DispatchCommandStatus::Claimed] as $status) {
            $offer = $this->offer();
            $this->command($offer, $status);

            $this->assertSame(0, $this->pushesSent($offer), "status {$status->value}");
        }
    }

    public function test_a_decline_uber_refused_does_not_withhold_it(): void
    {
        // Uber would not take the decline, so the ride IS the driver's after all and
        // the details are what they need. A settled-but-unapplied command must not
        // read the same as one still in flight.
        $offer = $this->offer();
        $this->command($offer, DispatchCommandStatus::Failed, ['uber_success' => false, 'uber_error' => 'expired']);

        $this->assertSame(1, $this->pushesSent($offer));
    }

    public function test_a_command_nobody_collected_does_not_withhold_it(): void
    {
        $offer = $this->offer();
        $this->command($offer, DispatchCommandStatus::Expired);

        $this->assertSame(1, $this->pushesSent($offer));
    }

    public function test_it_is_withheld_when_there_is_nothing_to_add(): void
    {
        // A cold geocode found nothing usable: this would repeat the bare push and
        // cost the driver a second notification carrying no new information.
        $this->assertSame(0, $this->pushesSent($this->offer(['distance_m' => null])));
    }

    public function test_it_is_withheld_once_the_company_switch_closes(): void
    {
        $offer = $this->offer();
        $this->tenant->setDispatchRejectEnabled(false);

        $this->assertSame(0, $this->pushesSent($offer->refresh()));
    }

    public function test_it_is_withheld_for_an_offer_no_driver_is_linked_to(): void
    {
        $this->assertSame(0, $this->pushesSent($this->offer(['driver_id' => null])));
    }

    public function test_a_long_stale_follow_up_is_dropped(): void
    {
        // After a worker outage or a "retry all" on failed jobs this would otherwise
        // push trip details for rides that finished hours ago.
        $offer = $this->offer();
        $offer->forceFill(['received_at' => now()->subSeconds(SendEnrichedOfferPush::MAX_AGE_SECONDS + 60)])->save();

        $this->assertSame(0, $this->pushesSent($offer));
    }

    /** Run the job against one offer and report how many pushes it sent. */
    private function pushesSent(DispatchOffer $offer): int
    {
        $sent = 0;
        $notifier = Mockery::mock(DispatchNotifier::class);
        $notifier->shouldReceive('notify')->andReturnUsing(function () use (&$sent) {
            $sent++;

            return 1;
        });

        (new SendEnrichedOfferPush($offer->id))->handle($notifier);

        return $sent;
    }

    /** @param  array<string, mixed>  $attributes */
    private function offer(array $attributes = []): DispatchOffer
    {
        $uuid = 'o-'.uniqid();

        return DispatchOffer::withoutGlobalScopes()->create(array_merge([
            'tenant_id' => $this->tenant->id,
            'driver_id' => $this->driver->id,
            'driver_uuid' => self::DRIVER_UUID,
            'offer_uuid' => $uuid,
            'real_offer_uuid' => 'real-'.$uuid,
            'pickup_address' => 'Königswall 15, 44137 Dortmund',
            'dropoff_address' => 'Bunsen-Kirchhoff-Straße 11, 44139 Dortmund',
            'fare_formatted' => '€7.41',
            'fare_amount' => 7.41,
            'accept_window_seconds' => 5,
            'received_at' => now(),
            'offer_generated_at' => now(),
            'status' => OfferStatus::Pending,
            // The geocode has landed — that is what this push exists to deliver.
            'distance_m' => 7400,
            'geo_synced_at' => now(),
            'raw_payload' => [],
        ], $attributes));
    }

    /** @param  array<string, mixed>  $extra */
    private function command(DispatchOffer $offer, DispatchCommandStatus $status, array $extra = []): void
    {
        OfferDispatchCommand::withoutGlobalScopes()->create(array_merge([
            'tenant_id' => $this->tenant->id,
            'dispatch_offer_id' => $offer->id,
            'uber_fleet_session_id' => $this->session->id,
            'action' => DispatchCommandAction::Reject,
            'driver_id' => $this->driver->id,
            'offer_uuid' => $offer->offer_uuid,
            'real_offer_uuid' => $offer->real_offer_uuid,
            'offer_type' => 'JOB',
            'driver_uuid' => self::DRIVER_UUID,
            'status' => $status,
            'expires_at' => now()->addMinute(),
        ], $extra));
    }
}
