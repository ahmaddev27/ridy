<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\DispatchCommandQueue;
use App\Domain\Dispatch\DispatchCommandStatus;
use App\Domain\Dispatch\Models\DaemonShard;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\OfferDispatchCommand;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\OfferLifecycle;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Events\OfferBroadcast;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The panel-side decline, end to end: a driver taps once, the daemon that owns
 * that company (and only that one) is handed the frozen mutation, and ONLY Uber's
 * own "isSuccess: true" is allowed to move the offer.
 *
 * The invariants worth breaking a build over:
 *   - a refusal is a 200 with a reason, never an HTTP error — the pop-up has to
 *     be able to TELL the driver why the button did nothing;
 *   - one offer can only ever produce one command, however many times it is tapped;
 *   - a decline Uber REFUSED leaves the offer pending, because the driver may
 *     still take the ride;
 *   - a decline Uber CONFIRMED can never be re-attributed as an acceptance, and
 *     never lands in an acceptance-rate figure.
 */
class DispatchRejectTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    private const DRIVER_UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    private Tenant $tenant;

    private Driver $driver;

    private UberFleetSession $session;

    private DaemonShard $shard;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
        $this->seed(RolePermissionSeeder::class);
        config(['services.dispatch.ingest_secret' => self::SECRET]);

        $this->tenant = Tenant::create([
            'name' => 'YA', 'country' => 'DE',
            'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        $this->tenant->setDispatchRejectEnabled(true);
        app(TenantContext::class)->set($this->tenant->id);

        $this->shard = DaemonShard::create(['name' => 'main', 'active' => true, 'last_seen_at' => now()]);
        $this->session = UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => 'org-1',
            'cookies' => [['name' => 'a', 'value' => 'b']], 'status' => UberFleetSession::STATUS_ACTIVE,
        ]);
        $this->session->forceFill(['shard_id' => $this->shard->id])->save();

        $this->driver = Driver::create([
            'tenant_id' => $this->tenant->id, 'name' => 'Mhmoud',
            'uber_driver_uuid' => self::DRIVER_UUID, 'email' => 'm@ya.de',
        ]);
    }

    // ---------------------------------------------------------------- requesting

    public function test_a_driver_tapping_decline_queues_the_frozen_mutation(): void
    {
        $offer = $this->offer();
        Sanctum::actingAs($this->driver, guard: 'driver');

        $this->postJson("/api/v1/driver/offers/{$offer->id}/dispatch-reject")
            ->assertOk()
            ->assertJsonPath('data.status', 'queued');

        $command = OfferDispatchCommand::withoutGlobalScopes()->firstOrFail();
        $this->assertSame($offer->offer_uuid, $command->offer_uuid);
        $this->assertSame($offer->real_offer_uuid, $command->real_offer_uuid);
        // Uber never sends offerType, so the client constant is what goes on the row.
        $this->assertSame('JOB', $command->offer_type);
        $this->assertSame(self::DRIVER_UUID, $command->driver_uuid);
        $this->assertSame($this->driver->id, $command->driver_id);
        $this->assertSame($this->session->id, $command->uber_fleet_session_id);
        $this->assertSame(DispatchCommandStatus::Queued, $command->status);
    }

    public function test_a_manager_can_decline_from_the_dashboard(): void
    {
        $offer = $this->offer();
        Sanctum::actingAs($this->manager());

        $this->postJson("/api/v1/dispatch/offers/{$offer->id}/dispatch-reject")
            ->assertOk()
            ->assertJsonPath('data.status', 'queued');

        $command = OfferDispatchCommand::withoutGlobalScopes()->firstOrFail();
        // Who asked is recorded on the row: the manager, with no driver attributed.
        $this->assertNotNull($command->user_id);
        $this->assertNull($command->driver_id);
    }

    public function test_a_viewer_may_not_decline_an_offer(): void
    {
        $offer = $this->offer();
        $viewer = User::create(['name' => 'V', 'email' => 'v@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id]);
        $viewer->assignRole('viewer');
        Sanctum::actingAs($viewer);

        $this->postJson("/api/v1/dispatch/offers/{$offer->id}/dispatch-reject")->assertForbidden();
        $this->assertSame(0, OfferDispatchCommand::withoutGlobalScopes()->count());
    }

    public function test_another_drivers_offer_is_not_found(): void
    {
        $other = Driver::create([
            'tenant_id' => $this->tenant->id, 'name' => 'Omar',
            'uber_driver_uuid' => 'other-uuid', 'email' => 'o@ya.de',
        ]);
        $offer = $this->offer(['driver_id' => $other->id, 'driver_uuid' => 'other-uuid']);
        Sanctum::actingAs($this->driver, guard: 'driver');

        $this->postJson("/api/v1/driver/offers/{$offer->id}/dispatch-reject")->assertNotFound();
        $this->assertSame(0, OfferDispatchCommand::withoutGlobalScopes()->count());
    }

    public function test_another_tenants_offer_is_not_found_from_the_dashboard(): void
    {
        $foreign = Tenant::create(['name' => 'Other', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
        $offer = DispatchOffer::withoutGlobalScopes()->create([
            'tenant_id' => $foreign->id, 'driver_uuid' => 'x', 'offer_uuid' => 'o-foreign',
            'real_offer_uuid' => 'r-foreign', 'received_at' => now(), 'accept_window_seconds' => 5,
            'status' => OfferStatus::Pending, 'raw_payload' => [],
        ]);
        Sanctum::actingAs($this->manager());

        $this->postJson("/api/v1/dispatch/offers/{$offer->id}/dispatch-reject")->assertNotFound();
    }

    /**
     * Every refusal reason, each as a 200 the client can explain. A 4xx here would
     * read to the app as "something broke" instead of "the window closed".
     *
     * @param  callable(DispatchOffer, Tenant): void  $arrange
     */
    #[DataProvider('refusals')]
    public function test_a_decline_that_cannot_be_sent_is_refused_with_a_reason(string $reason, callable $arrange): void
    {
        $offer = $this->offer();
        $arrange($offer, $this->tenant);
        Sanctum::actingAs($this->driver, guard: 'driver');

        $this->postJson("/api/v1/driver/offers/{$offer->id}/dispatch-reject")
            ->assertOk()
            ->assertJsonPath('data.status', 'refused')
            ->assertJsonPath('data.reason', $reason);

        $this->assertSame(0, OfferDispatchCommand::withoutGlobalScopes()->count());
    }

    /** @return array<string, array{0: string, 1: callable}> */
    public static function refusals(): array
    {
        return [
            'company switch off' => ['disabled', fn ($offer, Tenant $tenant) => $tenant->setDispatchRejectEnabled(false)],
            'already answered' => ['not_pending', fn (DispatchOffer $offer) => $offer->forceFill(['status' => OfferStatus::Accepted, 'accepted_at' => now()])->save()],
            'window closed' => ['window_closed', fn (DispatchOffer $offer) => $offer->forceFill(['received_at' => now()->subMinutes(10), 'offer_generated_at' => now()->subMinutes(10)])->save()],
            'no realOfferUUID' => ['missing_real_offer_uuid', fn (DispatchOffer $offer) => $offer->forceFill(['real_offer_uuid' => null])->save()],
            'no driver uuid' => ['missing_driver_uuid', fn (DispatchOffer $offer) => $offer->forceFill(['driver_uuid' => ''])->save()],
            'no live daemon session' => ['no_session', fn () => UberFleetSession::withoutGlobalScopes()->delete()],
        ];
    }

    public function test_a_double_tap_produces_exactly_one_command(): void
    {
        $offer = $this->offer();
        Sanctum::actingAs($this->driver, guard: 'driver');

        $first = $this->postJson("/api/v1/driver/offers/{$offer->id}/dispatch-reject")->assertOk();
        $second = $this->postJson("/api/v1/driver/offers/{$offer->id}/dispatch-reject")->assertOk();

        $this->assertSame('queued', $first->json('data.status'));
        // The second tap resolves to the SAME row — Uber is never asked twice.
        $this->assertSame('duplicate', $second->json('data.status'));
        $this->assertSame($first->json('data.command_id'), $second->json('data.command_id'));
        $this->assertSame(1, OfferDispatchCommand::withoutGlobalScopes()->count());
    }

    public function test_the_resource_tells_the_ui_whether_the_button_may_be_shown(): void
    {
        $open = $this->offer();
        $closed = $this->offer(['received_at' => now()->subMinutes(10), 'offer_generated_at' => now()->subMinutes(10)]);
        Sanctum::actingAs($this->driver, guard: 'driver');

        $this->getJson("/api/v1/driver/offers/{$open->id}")
            ->assertOk()
            ->assertJsonPath('data.can_decline', true)
            ->assertJsonPath('data.dispatch_rejected_at', null);

        $this->getJson("/api/v1/driver/offers/{$closed->id}")
            ->assertOk()
            ->assertJsonPath('data.can_decline', false);
    }

    // -------------------------------------------------------------- the daemon

    public function test_the_long_poll_hands_the_command_to_the_shard_that_owns_the_company(): void
    {
        $offer = $this->offer();
        Sanctum::actingAs($this->driver, guard: 'driver');
        $this->postJson("/api/v1/driver/offers/{$offer->id}/dispatch-reject")->assertOk();

        $response = $this->daemon('main')->getJson('/api/v1/internal/dispatch/commands?wait=0')->assertOk();

        $this->assertCount(1, $response->json('data'));
        $this->assertSame([
            'id', 'session_id', 'action', 'offer_uuid', 'real_offer_uuid', 'offer_type', 'driver_uuid',
        ], array_keys($response->json('data.0')));
        $this->assertSame('reject', $response->json('data.0.action'));

        $command = OfferDispatchCommand::withoutGlobalScopes()->firstOrFail();
        $this->assertSame(DispatchCommandStatus::Claimed, $command->status);
        $this->assertSame(1, $command->attempts);
        $this->assertNotNull($command->claimed_at);

        // Claimed work is never handed out twice, so a second box (or a re-poll)
        // cannot make us fire the same mutation again.
        $this->daemon('main')->getJson('/api/v1/internal/dispatch/commands?wait=0')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_a_shard_never_sees_another_shards_company(): void
    {
        $offer = $this->offer();
        Sanctum::actingAs($this->driver, guard: 'driver');
        $this->postJson("/api/v1/driver/offers/{$offer->id}/dispatch-reject")->assertOk();

        $this->daemon('box-2')->getJson('/api/v1/internal/dispatch/commands?wait=0')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->assertSame(DispatchCommandStatus::Queued, OfferDispatchCommand::withoutGlobalScopes()->firstOrFail()->status);
    }

    public function test_a_result_from_the_wrong_shard_is_refused(): void
    {
        $command = $this->claimed();
        // The second box registers itself the only way a box ever does — by polling.
        $this->daemon('box-2')->getJson('/api/v1/internal/dispatch/commands?wait=0')->assertOk();

        $this->daemon('box-2')
            ->postJson("/api/v1/internal/dispatch/commands/{$command->id}/result", ['is_success' => true])
            ->assertStatus(409);

        $this->assertNull($command->fresh()->uber_success);
        $this->assertNull($this->offerOf($command)->dispatch_rejected_at);
    }

    public function test_a_result_must_say_what_uber_answered(): void
    {
        $command = $this->claimed();

        $this->daemon('main')
            ->postJson("/api/v1/internal/dispatch/commands/{$command->id}/result", ['latency_ms' => -1])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['is_success', 'latency_ms']);
    }

    public function test_an_uber_confirmed_decline_settles_the_offer_and_nudges_the_app(): void
    {
        Event::fake([OfferBroadcast::class]);
        $command = $this->claimed();

        $this->daemon('main')
            ->postJson("/api/v1/internal/dispatch/commands/{$command->id}/result", [
                'is_success' => true, 'error' => null, 'latency_ms' => 820,
            ])
            ->assertOk()
            ->assertJsonPath('data.status', 'succeeded');

        $command->refresh();
        $this->assertTrue($command->uber_success);
        $this->assertNotNull($command->completed_at);

        // latency_ms is the OFFER'S AGE when Uber answered, computed here from
        // offer_generated_at — not the 820 ms the daemon reported for its own call.
        // That is the whole point of the column: Uber's real deadline for a dispatch
        // decline is unknown, and only the offer's age at the verdict can reveal it.
        $generatedAt = $this->offerOf($command)->offer_generated_at;
        $this->assertNotNull($generatedAt);
        $this->assertNotSame(820, $command->latency_ms);
        $this->assertGreaterThanOrEqual(0, $command->latency_ms);
        $this->assertLessThanOrEqual(
            (int) round(now()->diffInMilliseconds($generatedAt, absolute: true)) + 50,
            $command->latency_ms,
        );

        $offer = $this->offerOf($command);
        $this->assertSame(OfferStatus::Rejected, $offer->status);
        $this->assertNotNull($offer->dispatch_rejected_at);
        Event::assertDispatched(OfferBroadcast::class);
    }

    public function test_a_decline_confirmed_after_the_driver_already_took_the_ride_leaves_the_trip_alone(): void
    {
        $command = $this->claimed();
        $offer = $this->offerOf($command);

        // The round trip to Uber takes seconds, and acceptance is INFERRED from the
        // driver's engagement edge — so the offer can legitimately be accepted (even
        // completed) by the time the verdict lands.
        app(OfferLifecycle::class)->accept($offer);

        $this->daemon('main')
            ->postJson("/api/v1/internal/dispatch/commands/{$command->id}/result", [
                'is_success' => true, 'error' => null, 'latency_ms' => 4200,
            ])
            ->assertOk();

        // Uber's verdict is still recorded, so the disagreement stays visible...
        $command->refresh();
        $this->assertTrue($command->uber_success);

        // ...but the offer must NOT be stamped. dispatch_rejected_at means "this
        // never reached the driver", and on a ride they actually took that erases
        // its fare and kilometres from their stats and renders a real trip as
        // declined. The ride is the truth worth keeping.
        $offer->refresh();
        $this->assertNull($offer->dispatch_rejected_at);
        $this->assertSame(OfferStatus::Accepted, $offer->status);
    }

    public function test_a_refused_decline_leaves_the_offer_pending_and_stores_the_error(): void
    {
        $command = $this->claimed();

        $this->daemon('main')
            ->postJson("/api/v1/internal/dispatch/commands/{$command->id}/result", [
                'is_success' => false, 'error' => 'offer already expired', 'latency_ms' => 5400,
            ])
            ->assertOk()
            ->assertJsonPath('data.status', 'failed');

        $command->refresh();
        $this->assertFalse($command->uber_success);
        $this->assertSame('offer already expired', $command->uber_error);

        // The driver may still take the ride, so nothing about the offer may move.
        $offer = $this->offerOf($command);
        $this->assertSame(OfferStatus::Pending, $offer->status);
        $this->assertNull($offer->dispatch_rejected_at);
    }

    public function test_a_redelivered_result_cannot_undo_a_confirmed_decline(): void
    {
        $command = $this->claimed();
        $url = "/api/v1/internal/dispatch/commands/{$command->id}/result";

        $this->daemon('main')->postJson($url, ['is_success' => true])->assertOk();
        $this->daemon('main')->postJson($url, ['is_success' => false, 'error' => 'late'])->assertOk();

        $command->refresh();
        $this->assertSame(DispatchCommandStatus::Succeeded, $command->status);
        $this->assertTrue($command->uber_success);
        $this->assertNull($command->uber_error);
    }

    public function test_a_command_nobody_collected_is_expired_by_the_sweep(): void
    {
        $command = $this->claimed();
        $command->forceFill(['status' => DispatchCommandStatus::Queued, 'expires_at' => now()->subMinute()])->save();

        $this->assertSame(1, app(DispatchCommandQueue::class)->expireStale());
        $this->assertSame(DispatchCommandStatus::Expired, $command->fresh()->status);
        // Idempotent: a second sweep has nothing left to settle.
        $this->assertSame(0, app(DispatchCommandQueue::class)->expireStale());
    }

    // ------------------------------------------------------- the accounting edge

    public function test_a_confirmed_decline_is_never_re_attributed_as_an_acceptance(): void
    {
        $command = $this->claimed();
        $this->daemon('main')->postJson("/api/v1/internal/dispatch/commands/{$command->id}/result", ['is_success' => true])->assertOk();

        // This is the exact lookup DriverStatusIngestor uses on an engagement edge:
        // the driver going ON_TRIP a moment later must NOT pick the declined offer up
        // and turn it into an accept.
        $this->assertNull(
            app(OfferLifecycle::class)->pendingOfferFor($this->tenant->id, self::DRIVER_UUID),
            'a decline Uber confirmed is not an offer the driver can still be credited with',
        );
    }

    public function test_a_dispatch_decline_leaves_the_acceptance_rate_alone(): void
    {
        // One offer the driver accepted, one declined on the panel.
        $this->offer(['status' => OfferStatus::Accepted, 'accepted_at' => now()]);
        $this->offer(['dispatch_rejected_at' => now(), 'status' => OfferStatus::Rejected, 'rejected_at' => now()]);
        Sanctum::actingAs($this->driver, guard: 'driver');

        $stats = $this->getJson('/api/v1/driver/stats')->assertOk()->json('data');

        // The declined offer never reached the driver's Uber app, so it is outside
        // every accepted/declined figure and reported on its own instead.
        $this->assertSame(1, $stats['total']);
        $this->assertSame(1, $stats['accepted']);
        $this->assertSame(0, $stats['declined']);
        $this->assertSame(1, $stats['dispatch_declined']);
        $this->assertSame(100, $stats['acceptance_rate']);
    }

    // ------------------------------------------------------------------ helpers

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
            'raw_payload' => [],
        ], $attributes));
    }

    private function manager(): User
    {
        $user = User::firstOrCreate(
            ['email' => 'm-owner@ya.de'],
            ['name' => 'M', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id],
        );
        $user->assignRole('fleet_manager');

        return $user;
    }

    /** A command already handed to the "main" shard, as the daemon would have claimed it. */
    private function claimed(): OfferDispatchCommand
    {
        $offer = $this->offer();
        Sanctum::actingAs($this->driver, guard: 'driver');
        $this->postJson("/api/v1/driver/offers/{$offer->id}/dispatch-reject")->assertOk();
        $this->daemon('main')->getJson('/api/v1/internal/dispatch/commands?wait=0')->assertOk();

        return OfferDispatchCommand::withoutGlobalScopes()->firstOrFail();
    }

    private function offerOf(OfferDispatchCommand $command): DispatchOffer
    {
        return DispatchOffer::withoutGlobalScopes()->findOrFail($command->dispatch_offer_id);
    }

    private function daemon(string $shard): static
    {
        return $this->withHeaders([
            'X-Dispatch-Secret' => self::SECRET,
            'X-Shard-Id' => $shard,
        ]);
    }
}
