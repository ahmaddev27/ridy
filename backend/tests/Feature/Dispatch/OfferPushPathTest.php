<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\DispatchOfferIngestor;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\OfferLifecycle;
use App\Domain\Dispatch\TripGeocoder;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\DispatchNotifier;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The core promise: an offer push reaches the driver inside Uber's ~5 s window,
 * and nothing optional (supersede UPDATE, broadcast, one bad offer) can drop it.
 */
class OfferPushPathTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    private const DRIVER_UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    private object $spy;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
        config(['services.dispatch.ingest_secret' => self::SECRET]);

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

        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'uber_org_uuid' => self::ORG]);
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'uber_org_uuid' => self::ORG, 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);
        app(TenantContext::class)->set($tenant->id);
        $driver = Driver::create(['name' => 'Mhmoud', 'uber_driver_uuid' => self::DRIVER_UUID]);
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 'phone', 'tenant_id' => $tenant->id]);
    }

    private function offer(string $uuid): array
    {
        return [
            'offerUUID' => $uuid,
            'partnerUUID' => self::ORG,
            'driverInfo' => ['driverUUID' => self::DRIVER_UUID],
            'pickupAddress' => 'Königswall 15, 44137 Dortmund',
            'dropoffAddress' => 'Bunsen-Kirchhoff-Straße 11, 44139 Dortmund',
            'formattedUFP' => '€7.41',
            'acceptWindowInSeconds' => 5,
        ];
    }

    private function ingest(array $offers)
    {
        return $this->withHeader('X-Dispatch-Secret', self::SECRET)
            ->postJson('/api/v1/internal/dispatch/ingest', ['offers' => $offers, 'seq' => 1]);
    }

    public function test_a_deadlocked_supersede_never_blocks_the_push_or_the_batch(): void
    {
        $pdo = new \PDOException('Deadlock found when trying to get lock');
        $pdo->errorInfo = ['40001', 1213, 'Deadlock found when trying to get lock'];
        $deadlock = new QueryException('mysql', 'update dispatch_offers ...', [], $pdo);

        $this->partialMock(OfferLifecycle::class, function ($mock) use ($deadlock) {
            $mock->shouldReceive('supersedePendingFor')->andThrow($deadlock);
        });

        $this->ingest([$this->offer('o-1'), $this->offer('o-2')])
            ->assertOk()
            ->assertJsonPath('data.routed', 2)
            ->assertJsonPath('data.error', 0);

        $this->assertSame(['phone', 'phone'], $this->spy->tokens, 'both offers must still be pushed');
    }

    public function test_one_failing_offer_does_not_drop_the_rest_of_the_daemon_batch(): void
    {
        $this->app->instance(DispatchOfferIngestor::class, new class(app(TenantContext::class), app(DispatchNotifier::class), app(OfferLifecycle::class), app(TripGeocoder::class)) extends DispatchOfferIngestor
        {
            public function ingest(int $tenantId, array $offer, ?int $seq = null, ?float $geocodeDeadline = null): array
            {
                if ($offer['offerUUID'] === 'bad') {
                    throw new \RuntimeException('boom');
                }

                return parent::ingest($tenantId, $offer, $seq, $geocodeDeadline);
            }
        });

        $this->ingest([$this->offer('bad'), $this->offer('good')])
            ->assertOk()
            ->assertJsonPath('data.error', 1)
            ->assertJsonPath('data.routed', 1);

        $this->assertSame(1, DispatchOffer::withoutGlobalScopes()->where('offer_uuid', 'good')->count());
        $this->assertSame(['phone'], $this->spy->tokens);
    }

    public function test_a_transient_db_failure_asks_the_daemon_to_retry_without_double_pushing(): void
    {
        $pdo = new \PDOException('SQLSTATE[HY000]: General error: 2006 MySQL server has gone away');
        $pdo->errorInfo = ['HY000', 2006, 'MySQL server has gone away'];
        $goneAway = new QueryException('mysql', 'insert into dispatch_offers ...', [], $pdo);

        $ingestor = new class($goneAway, app(TenantContext::class), app(DispatchNotifier::class), app(OfferLifecycle::class), app(TripGeocoder::class)) extends DispatchOfferIngestor
        {
            public bool $failOnce = true;

            public function __construct(private QueryException $failure, ...$deps)
            {
                parent::__construct(...$deps);
            }

            public function ingest(int $tenantId, array $offer, ?int $seq = null, ?float $geocodeDeadline = null): array
            {
                if ($offer['offerUUID'] === 'flaky' && $this->failOnce) {
                    $this->failOnce = false;
                    throw $this->failure;
                }

                return parent::ingest($tenantId, $offer, $seq, $geocodeDeadline);
            }
        };
        $this->app->instance(DispatchOfferIngestor::class, $ingestor);

        // The batch still processes the healthy offer, but answers 503 so the daemon retries.
        $this->ingest([$this->offer('ok'), $this->offer('flaky')])
            ->assertStatus(503)
            ->assertHeader('Retry-After', '1')
            ->assertJsonPath('data.routed', 1)
            ->assertJsonPath('data.error', 1);

        // The retry of the same message: the stored offer is a duplicate (no second push).
        $this->ingest([$this->offer('ok'), $this->offer('flaky')])
            ->assertOk()
            ->assertJsonPath('data.duplicate', 1)
            ->assertJsonPath('data.routed', 1);

        $this->assertSame(1, DispatchOffer::withoutGlobalScopes()->where('offer_uuid', 'ok')->count());
        $this->assertSame(['phone', 'phone'], $this->spy->tokens, 'each offer pushed exactly once');
    }

    public function test_non_scalar_offer_fields_are_ignored_instead_of_failing(): void
    {
        $offer = $this->offer('o-arr');
        $offer['riderFirstName'] = ['nested' => 'x'];
        $offer['acceptWindowInSeconds'] = 'soon';

        $this->ingest([$offer])->assertOk()->assertJsonPath('data.routed', 1);

        $stored = DispatchOffer::withoutGlobalScopes()->where('offer_uuid', 'o-arr')->first();
        $this->assertNull($stored->rider_first_name);
        $this->assertNull($stored->accept_window_seconds);
    }

    public function test_a_failing_broadcast_never_drops_the_push(): void
    {
        config(['broadcasting.default' => 'reverb', 'broadcasting.connections.reverb.options.host' => '127.0.0.1', 'broadcasting.connections.reverb.options.port' => 1]);

        $this->ingest([$this->offer('o-b')])->assertOk()->assertJsonPath('data.routed', 1);

        $this->assertSame(['phone'], $this->spy->tokens);
    }

    public function test_the_batch_shares_one_geocode_deadline(): void
    {
        $seen = [];
        $this->partialMock(TripGeocoder::class, function ($mock) use (&$seen) {
            $mock->shouldReceive('enrichForNotify')->andReturnUsing(function ($offer, $deadline = null) use (&$seen) {
                $seen[] = $deadline;

                return $offer;
            });
        });

        $this->ingest([$this->offer('d-1'), $this->offer('d-2')])->assertOk()->assertJsonPath('data.routed', 2);

        $this->assertCount(2, $seen);
        $this->assertNotNull($seen[0]);
        $this->assertSame($seen[0], $seen[1], 'every offer in one request must share a single budget');
    }

    public function test_offer_epoch_ms_times_are_stored_as_berlin_wall_clock(): void
    {
        // 2026-07-01 12:00:00 UTC = 14:00 in Berlin (CEST).
        $ms = 1782907200000;
        $offer = $this->offer('o-tz') + ['requestAt' => $ms, 'offerGeneratedAtMs' => $ms];

        $this->ingest([$offer])->assertOk();

        $raw = \DB::table('dispatch_offers')->where('offer_uuid', 'o-tz')->value('requested_at');
        $this->assertStringStartsWith('2026-07-01 14:00:00', (string) $raw);
    }
}
