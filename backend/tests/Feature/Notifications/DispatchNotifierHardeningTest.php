<?php

namespace Tests\Feature\Notifications;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\DispatchNotifier;
use App\Domain\Notifications\Jobs\NotifyOwnersOfOffer;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Illuminate\Contracts\Broadcasting\Factory as BroadcastFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class DispatchNotifierHardeningTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function pushSpy(): PushSender
    {
        return new class implements PushSender
        {
            public array $calls = [];

            public function send(string $deviceToken, string $title, string $body, array $data = []): bool
            {
                $this->calls[] = compact('deviceToken', 'title', 'body', 'data');

                return true;
            }
        };
    }

    private function offer(Driver $driver, array $attrs = []): DispatchOffer
    {
        return DispatchOffer::create($attrs + [
            'driver_id' => $driver->id, 'driver_uuid' => 'u1', 'offer_uuid' => 'o'.uniqid(),
            'fare_amount' => 10, 'received_at' => now(), 'raw_payload' => [], 'status' => OfferStatus::Pending,
        ]);
    }

    public function test_push_is_still_sent_when_the_broadcast_transport_throws(): void
    {
        $this->app->instance(BroadcastFactory::class, new class implements BroadcastFactory
        {
            public function connection($name = null)
            {
                throw new RuntimeException('reverb down');
            }

            public function event($event = null)
            {
                throw new RuntimeException('reverb down');
            }
        });

        $driver = Driver::create(['name' => 'Omar']);
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 't1', 'tenant_id' => $this->tenant->id]);
        $spy = $this->pushSpy();

        $sent = (new DispatchNotifier($spy))->notify($this->offer($driver));

        $this->assertSame(1, $sent);
        $this->assertCount(1, $spy->calls);
    }

    public function test_address_less_stop_keeps_route_order_in_payload_and_body(): void
    {
        $driver = Driver::create(['name' => 'Omar', 'locale' => 'en']);
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 't1', 'tenant_id' => $this->tenant->id]);
        $offer = $this->offer($driver, [
            'status' => OfferStatus::Accepted,
            'stops' => [
                ['address' => 'Hauptstraße 1, 42651 Solingen', 'lat' => 51.1, 'lng' => 7.0, 'leg_m' => null],
                ['address' => null, 'lat' => 51.2, 'lng' => 7.1, 'leg_m' => 2000],
                ['address' => 'Bahnhofstraße 2, 42651 Solingen', 'lat' => 51.3, 'lng' => 7.2, 'leg_m' => 3000],
            ],
        ]);
        $spy = $this->pushSpy();

        (new DispatchNotifier($spy))->notifyMultiStop($offer, 2);

        $stops = json_decode($spy->calls[0]['data']['stops'], true);
        $this->assertCount(3, $stops);
        $this->assertNull($stops[1]['address']);
        $this->assertSame(51.2, $stops[1]['lat']);
        $this->assertStringContainsString('• 51.20000, 7.10000 (+2.0 km)', $spy->calls[0]['body']);
        $this->assertSame('Multi-stop detected', $spy->calls[0]['title']);
    }

    public function test_owner_multi_stop_title_uses_each_owners_locale(): void
    {
        $driver = Driver::create(['name' => 'Omar', 'locale' => 'de']);
        $owner = User::create(['name' => 'Boss', 'email' => 'boss@ya.de', 'password' => 'x', 'tenant_id' => $this->tenant->id]);
        $owner->forceFill(['locale' => 'en'])->save();
        DeviceToken::create(['user_id' => $owner->id, 'token' => 'own', 'tenant_id' => $this->tenant->id]);
        $offer = $this->offer($driver, ['status' => OfferStatus::Accepted]);
        $spy = $this->pushSpy();

        $sent = (new DispatchNotifier($spy))->notifyOwners($offer, 2);

        $this->assertSame(1, $sent);
        $this->assertSame('Multi-stop detected', $spy->calls[0]['title']);
    }

    public function test_oversized_payload_drops_stops_json_instead_of_failing(): void
    {
        $driver = Driver::create(['name' => 'Omar']);
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 't1', 'tenant_id' => $this->tenant->id]);
        $stops = [];
        for ($i = 0; $i < 40; $i++) {
            $stops[] = ['address' => str_repeat('Langer Straßenname ', 4).$i.', 42651 Solingen', 'lat' => 51 + $i / 100, 'lng' => 7.0, 'leg_m' => 1000];
        }
        $offer = $this->offer($driver, ['status' => OfferStatus::Accepted, 'stops' => $stops]);
        $spy = $this->pushSpy();

        (new DispatchNotifier($spy))->notifyMultiStop($offer, 39);

        $call = $spy->calls[0];
        $this->assertSame('', $call['data']['stops']);
        $this->assertLessThanOrEqual(3500, strlen((string) json_encode(['t' => $call['title'], 'b' => $call['body'], 'd' => $call['data']], JSON_UNESCAPED_UNICODE)));
    }

    public function test_stale_owner_job_sends_nothing_but_fresh_multistop_follow_up_does(): void
    {
        $driver = Driver::create(['name' => 'Omar']);
        $owner = User::create(['name' => 'Boss', 'email' => 'b@ya.de', 'password' => 'x', 'tenant_id' => $this->tenant->id]);
        DeviceToken::create(['user_id' => $owner->id, 'token' => 'own', 'tenant_id' => $this->tenant->id]);
        $offer = $this->offer($driver, ['status' => OfferStatus::Accepted]);
        $spy = $this->pushSpy();
        $notifier = new DispatchNotifier($spy);

        $stale = new NotifyOwnersOfOffer((int) $offer->id);
        $stale->queuedAt = time() - NotifyOwnersOfOffer::MAX_AGE_SECONDS - 5;
        $stale->handle($notifier);
        $this->assertCount(0, $spy->calls);

        (new NotifyOwnersOfOffer((int) $offer->id, 2))->handle($notifier);
        $this->assertCount(1, $spy->calls);

        // The multi-stop follow-up describes a running trip: it outlives the 60 s cutoff.
        $lateFollowUp = new NotifyOwnersOfOffer((int) $offer->id, 2);
        $lateFollowUp->queuedAt = time() - NotifyOwnersOfOffer::MAX_AGE_SECONDS - 30;
        $lateFollowUp->handle($notifier);
        $this->assertCount(2, $spy->calls);
    }

    public function test_owner_pushes_run_on_their_own_queue_ahead_of_slow_jobs(): void
    {
        // The worker/scheduler serve `push,mail,default`: geocode backlogs can't age these out.
        $this->assertSame(NotifyOwnersOfOffer::QUEUE, (new NotifyOwnersOfOffer(1))->queue);
        $this->assertSame('push', NotifyOwnersOfOffer::QUEUE);
    }
}
