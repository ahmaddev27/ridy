<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Domain\Notifications\AppNotification;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Http\Controllers\Api\V1\ElProfessorController;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\DatabaseNotification;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;
use App\Jobs\RingElProfessor;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * El-Professor pulls the roster with a token that holds only `elprofessor:read`.
 * The confinement test is the point: an ability missing from
 * EnsureDashboardToken::CONFINED_ABILITIES would reach every dashboard route.
 */
class ElProfessorConnectionTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Tenant $other;

    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = $this->makeTenant('YA Mobility');
        $this->other = $this->makeTenant('Other Fleet');
        app(TenantContext::class)->set($this->tenant->id);
        $this->manager = $this->user('fleet_manager', 'm@ya.de', $this->tenant);
    }

    private function makeTenant(string $name): Tenant
    {
        return Tenant::create([
            'name' => $name, 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
    }

    private function user(string $role, string $email, Tenant $tenant): User
    {
        $user = User::create([
            'name' => 'U', 'email' => $email,
            'password' => Hash::make('secret123'), 'tenant_id' => $tenant->id,
        ]);
        $user->assignRole($role);

        return $user;
    }

    private function bearer(string $plainToken): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$plainToken];
    }

    private function mint(): string
    {
        Sanctum::actingAs($this->manager, ['*']);

        return $this->postJson('/api/v1/elprofessor/token')->assertOk()->json('data.token');
    }

    private function driver(Tenant $tenant, string $name): Driver
    {
        return Driver::create([
            'tenant_id' => $tenant->id, 'name' => $name, 'email' => strtolower($name).'@x.de',
            'phone' => '+49170', 'employment_type' => 'employee',
            'pseudonym_id' => 'secret-'.$name, 'latitude' => 52.5, 'longitude' => 13.4,
            'uber_rating' => 4.9, 'uber_picture_url' => 'https://img/x.png',
        ]);
    }

    /**
     * Act as the driver, always resolved from the database.
     *
     * `Sanctum::actingAs` pins the in-memory instance onto the guard, and
     * `documents_enabled` reads `$driver->tenant` -- a relation the driver's
     * first call lazily loads and then caches on that instance. Reusing the
     * variable therefore answers from the tenant as it was BEFORE the pull.
     * Measured: the database said connected, the reused instance said not.
     * A real request resolves the tokenable per request, so this is the
     * test's artefact and not the product's -- but a test that reads stale
     * state cannot fail for the right reason either, which is why the
     * revocation test uses this too.
     */
    private function actingAsDriver(Driver $driver): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(Driver::withoutGlobalScopes()->findOrFail($driver->id), guard: 'driver');
    }

    public function test_a_user_without_connections_manage_is_refused_the_token_endpoints(): void
    {
        $viewer = $this->user('viewer', 'v@ya.de', $this->tenant);
        Sanctum::actingAs($viewer, ['*']);

        $this->postJson('/api/v1/elprofessor/token')->assertForbidden();
        $this->deleteJson('/api/v1/elprofessor/token')->assertForbidden();
        $this->getJson('/api/v1/elprofessor/connection')->assertForbidden();
    }

    public function test_minting_returns_the_identity_and_connection_never_returns_the_token(): void
    {
        Sanctum::actingAs($this->manager, ['*']);

        $this->postJson('/api/v1/elprofessor/token')
            ->assertOk()
            ->assertJsonPath('data.tenant_id', $this->tenant->id)
            ->assertJsonPath('data.tenant_name', 'YA Mobility')
            ->assertJsonPath('data.payment_reference', $this->tenant->fresh()->payment_reference)
            ->assertJsonStructure(['data' => ['token']]);

        $this->getJson('/api/v1/elprofessor/connection')
            ->assertOk()
            ->assertJsonPath('data.connected', false)
            ->assertJsonPath('data.first_used_at', null)
            ->assertJsonMissingPath('data.token');
        $this->assertNotNull($this->tenant->fresh()->settings['elprofessor']['token_issued_at']);
    }

    public function test_the_token_reads_the_roster_but_nothing_else_on_the_dashboard(): void
    {
        $token = $this->mint();

        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))->assertOk();
        $this->getJson('/api/v1/drivers', $this->bearer($token))->assertForbidden();
        $this->getJson('/api/v1/dashboard/summary', $this->bearer($token))->assertForbidden();
        $this->postJson('/api/v1/elprofessor/token', [], $this->bearer($token))->assertForbidden();
        $this->deleteJson('/api/v1/elprofessor/token', [], $this->bearer($token))->assertForbidden();
        $this->getJson('/api/v1/elprofessor/connection', $this->bearer($token))->assertForbidden();
        $this->getJson('/api/v1/me', $this->bearer($token))->assertForbidden();
    }

    public function test_the_roster_is_tenant_scoped_and_reduced(): void
    {
        $mine = $this->driver($this->tenant, 'Mine');
        $this->driver($this->other, 'Theirs');
        $token = $this->mint();

        $response = $this->getJson('/api/v1/elprofessor/fleet/drivers?per_page=500', $this->bearer($token))
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('meta.per_page', 100)
            ->assertJsonPath('meta.page', 1)
            ->assertJsonPath('data.0.id', $mine->id);

        $keys = array_keys($response->json('data.0'));
        sort($keys);
        $this->assertSame(
            ['activated_at', 'email', 'employment_type', 'id', 'name', 'phone', 'roster_removed_at', 'uber_driver_uuid'],
            $keys,
        );
        $this->assertStringNotContainsString('secret-Mine', $response->getContent());
    }

    public function test_first_pull_sets_first_used_at_and_flips_connected_and_documents_enabled(): void
    {
        $driver = $this->driver($this->tenant, 'Omar');
        $token = $this->mint();

        $this->actingAsDriver($driver);
        $this->getJson('/api/v1/driver/me')->assertOk()->assertJsonPath('data.documents_enabled', false);

        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))->assertOk();

        $state = $this->tenant->fresh()->settings['elprofessor'];
        $this->assertNotNull($state['first_used_at']);
        $this->assertNotNull($state['last_used_at']);

        Sanctum::actingAs($this->manager, ['*']);
        $this->getJson('/api/v1/elprofessor/connection')->assertOk()->assertJsonPath('data.connected', true);

        $this->actingAsDriver($driver);
        $this->getJson('/api/v1/driver/me')->assertOk()->assertJsonPath('data.documents_enabled', true);
    }

    public function test_last_used_at_is_written_at_most_once_an_hour_and_first_used_at_never_moves(): void
    {
        $token = $this->mint();
        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))->assertOk();
        $first = $this->tenant->fresh()->settings['elprofessor'];

        $this->travel(10)->minutes();
        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))->assertOk();
        $this->assertSame($first['last_used_at'], $this->tenant->fresh()->settings['elprofessor']['last_used_at']);

        $this->travel(61)->minutes();
        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))->assertOk();
        $later = $this->tenant->fresh()->settings['elprofessor'];
        $this->assertNotSame($first['last_used_at'], $later['last_used_at']);
        $this->assertSame($first['first_used_at'], $later['first_used_at']);
    }

    public function test_revoking_disconnects_and_the_old_token_stops_working(): void
    {
        $driver = $this->driver($this->tenant, 'Omar');
        $token = $this->mint();
        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))->assertOk();

        Sanctum::actingAs($this->manager, ['*']);
        $this->deleteJson('/api/v1/elprofessor/token')->assertOk();

        $connection = $this->getJson('/api/v1/elprofessor/connection')->assertOk();
        $connection->assertJsonPath('data.connected', false);
        $this->assertNotNull($connection->json('data.revoked_at'));

        $this->actingAsDriver($driver);
        $this->getJson('/api/v1/driver/me')->assertOk()->assertJsonPath('data.documents_enabled', false);

        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))->assertUnauthorized();
    }

    public function test_reminting_clears_revocation_and_usage(): void
    {
        $old = $this->mint();
        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($old))->assertOk();
        Sanctum::actingAs($this->manager, ['*']);
        $this->deleteJson('/api/v1/elprofessor/token')->assertOk();

        $new = $this->mint();

        $state = $this->tenant->fresh()->settings['elprofessor'];
        $this->assertNull($state['revoked_at']);
        $this->assertNull($state['first_used_at']);
        $this->assertNull($state['last_used_at']);
        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($old))->assertUnauthorized();
        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($new))->assertOk();
    }

    public function test_the_token_reads_its_fleet_identity_and_exactly_three_fields(): void
    {
        $token = $this->mint();

        $response = $this->getJson('/api/v1/elprofessor/fleet', $this->bearer($token))->assertOk();

        $this->assertSame(
            ['data' => [
                'tenant_id' => $this->tenant->id,
                'tenant_name' => 'YA Mobility',
                'payment_reference' => $this->tenant->fresh()->payment_reference,
            ]],
            $response->json(),
        );
    }

    public function test_the_fleet_identity_does_not_widen_the_confinement(): void
    {
        $token = $this->mint();
        $this->getJson('/api/v1/elprofessor/fleet', $this->bearer($token))->assertOk();

        $this->getJson('/api/v1/elprofessor/connection', $this->bearer($token))->assertForbidden();
        $this->getJson('/api/v1/drivers', $this->bearer($token))->assertForbidden();
        $this->getJson('/api/v1/me', $this->bearer($token))->assertForbidden();
    }

    public function test_the_roster_meta_carries_the_callers_own_tenant_id(): void
    {
        $token = $this->mint();

        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))
            ->assertOk()
            ->assertJsonPath('meta.tenant_id', $this->tenant->id)
            ->assertJsonMissingPath('meta.tenant_name');
    }

    public function test_a_token_never_shows_another_tenants_identity(): void
    {
        $token = $this->mint();

        $fleet = $this->getJson('/api/v1/elprofessor/fleet', $this->bearer($token))->assertOk();
        $roster = $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))->assertOk();

        $this->assertNotSame($this->other->id, $fleet->json('data.tenant_id'));
        $this->assertNotSame($this->other->id, $roster->json('meta.tenant_id'));
        $this->assertStringNotContainsString('Other Fleet', $fleet->getContent());
        $this->assertStringNotContainsString($this->other->fresh()->payment_reference, $fleet->getContent());
    }

    public function test_the_first_fleet_call_sets_first_used_at_so_connected_flips(): void
    {
        $token = $this->mint();
        $this->assertNull($this->tenant->fresh()->settings['elprofessor']['first_used_at']);

        $this->getJson('/api/v1/elprofessor/fleet', $this->bearer($token))->assertOk();

        $state = $this->tenant->fresh()->settings['elprofessor'];
        $this->assertNotNull($state['first_used_at']);
        $this->assertNotNull($state['last_used_at']);

        Sanctum::actingAs($this->manager, ['*']);
        $this->getJson('/api/v1/elprofessor/connection')->assertOk()->assertJsonPath('data.connected', true);
    }

    /**
     * `connected` has three terms and the revocation test pins none of them:
     * revokeToken() deletes the token rows AND records the time, so dropping
     * either term leaves the other answering and every test still passes.
     * Measured by mutating each term in turn -- only `first_used_at` was
     * caught. These two tests cover the other two.
     *
     * This one is a state reachable without the revoke endpoint at all:
     * Sanctum pruning, or the user who minted the token being deleted and
     * cascading its tokens away. `first_used_at` survives in settings, so if
     * the token-exists term went, the company would read "connected" and the
     * driver app would offer the documents section behind a token that can
     * pull nothing.
     */
    public function test_a_token_that_vanishes_outside_revocation_disconnects(): void
    {
        $driver = $this->driver($this->tenant, 'Omar');
        $token = $this->mint();
        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))->assertOk();

        $this->tenant->fresh()->elprofessorTokens()->delete();

        $state = $this->tenant->fresh()->settings['elprofessor'];
        $this->assertNull($state['revoked_at'], 'nothing recorded a revocation, so only the token term can answer');
        $this->assertNotNull($state['first_used_at']);

        Sanctum::actingAs($this->manager, ['*']);
        $this->getJson('/api/v1/elprofessor/connection')->assertOk()->assertJsonPath('data.connected', false);

        $this->actingAsDriver($driver);
        $this->getJson('/api/v1/driver/me')->assertOk()->assertJsonPath('data.documents_enabled', false);

        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))->assertUnauthorized();
    }

    /**
     * The mirror term, and this state is CONSTRUCTED rather than reachable:
     * revokeToken() deletes before it records, so a recorded revocation never
     * coexists with a live token row today. It is pinned anyway, because the
     * term is what makes the recorded decision authoritative instead of
     * inferred from a row's presence -- and a later change that keeps token
     * rows for an audit trail would make it the only guard left.
     */
    public function test_a_recorded_revocation_outranks_a_surviving_token_row(): void
    {
        $driver = $this->driver($this->tenant, 'Omar');
        $token = $this->mint();
        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))->assertOk();

        $this->tenant->fresh()->mergeElprofessorState(['revoked_at' => now()->toIso8601String()]);

        $this->assertTrue(
            $this->tenant->fresh()->elprofessorTokens()->exists(),
            'the point of this test is a live token row beside a recorded revocation',
        );

        Sanctum::actingAs($this->manager, ['*']);
        $this->getJson('/api/v1/elprofessor/connection')->assertOk()->assertJsonPath('data.connected', false);

        $this->actingAsDriver($driver);
        $this->getJson('/api/v1/driver/me')->assertOk()->assertJsonPath('data.documents_enabled', false);
    }

    /**
     * The rejection path. `AppNotification` stores a semantic type and params,
     * never rendered text, so these assert the SHAPE the driver app renders
     * from — not a sentence.
     */
    public function test_a_rejection_notifies_the_named_driver_with_a_type_and_params(): void
    {
        $driver = $this->driver($this->tenant, 'Omar');
        $token = $this->mint();

        $this->postJson('/api/v1/elprofessor/submissions/status', [
            'external_submission_id' => 'sub-1',
            'external_driver_id' => $driver->id,
            'status' => 'rejected',
            'reason_code' => 'review_rejected',
            'reason_text' => 'Beleg fehlt',
        ], $this->bearer($token))
            ->assertOk()
            ->assertJsonPath('data.notified', true)
            ->assertJsonPath('data.duplicate', false);

        $row = DatabaseNotification::query()
            ->where('notifiable_type', $driver->getMorphClass())
            ->where('notifiable_id', $driver->id)
            ->sole();

        $this->assertSame(AppNotification::class, $row->type);
        $this->assertSame(ElProfessorController::REJECTED_TYPE, $row->data['type']);
        $this->assertSame('sub-1', $row->data['params']['external_submission_id']);
        $this->assertSame('review_rejected', $row->data['params']['reason_code']);
        $this->assertSame('Beleg fehlt', $row->data['params']['reason_text']);
        $this->assertSame('note', $row->data['params']['kind']);
    }

    public function test_a_resent_rejection_does_not_notify_the_driver_twice(): void
    {
        $driver = $this->driver($this->tenant, 'Omar');
        $token = $this->mint();
        $payload = [
            'external_submission_id' => 'sub-1',
            'external_driver_id' => $driver->id,
            'status' => 'rejected',
            'reason_code' => 'review_rejected',
        ];

        $this->postJson('/api/v1/elprofessor/submissions/status', $payload, $this->bearer($token))
            ->assertOk()->assertJsonPath('data.notified', true);
        $this->postJson('/api/v1/elprofessor/submissions/status', $payload, $this->bearer($token))
            ->assertOk()
            ->assertJsonPath('data.notified', false)
            ->assertJsonPath('data.duplicate', true);

        $this->assertSame(1, DatabaseNotification::query()
            ->where('notifiable_id', $driver->id)->count());

        // A DIFFERENT submission is a different occurrence and does notify, or
        // the dedupe above would be indistinguishable from "notify once ever".
        $second = $payload;
        $second['external_submission_id'] = 'sub-2';
        $this->postJson('/api/v1/elprofessor/submissions/status', $second, $this->bearer($token))
            ->assertOk()->assertJsonPath('data.notified', true);
        $this->assertSame(2, DatabaseNotification::query()
            ->where('notifiable_id', $driver->id)->count());
    }

    public function test_a_driver_of_another_tenant_is_the_same_404_as_one_that_does_not_exist(): void
    {
        $theirs = $this->driver($this->other, 'Theirs');
        $token = $this->mint();

        $foreign = [
            'status' => 'rejected',
            'reason_code' => 'review_rejected',
            'external_submission_id' => 'sub-1',
            'external_driver_id' => $theirs->id,
        ];
        $nobody = $foreign;
        $nobody['external_driver_id'] = 999999;

        $other = $this->postJson('/api/v1/elprofessor/submissions/status', $foreign, $this->bearer($token));
        $missing = $this->postJson('/api/v1/elprofessor/submissions/status', $nobody, $this->bearer($token));

        $other->assertNotFound();
        $missing->assertNotFound();
        // Byte-identical, so the caller cannot tell a foreign fleet's driver
        // from a driver nobody has.
        $this->assertSame($missing->getContent(), $other->getContent());
        $this->assertSame(0, DatabaseNotification::query()->count());
    }

    public function test_only_a_rejection_is_accepted_and_nothing_is_silently_ignored(): void
    {
        $driver = $this->driver($this->tenant, 'Omar');
        $token = $this->mint();

        foreach (['accepted', 'pending', 'whatever'] as $status) {
            $this->postJson('/api/v1/elprofessor/submissions/status', [
                'external_submission_id' => 'sub-1',
                'external_driver_id' => $driver->id,
                'status' => $status,
                'reason_code' => 'review_rejected',
            ], $this->bearer($token))->assertStatus(422);
        }

        $this->assertSame(0, DatabaseNotification::query()->count());
    }

    /**
     * The point of the whole middleware: the token gained ONE write and must
     * have gained nothing else. An ability missing from CONFINED_ABILITIES is
     * not confined at all, and a wildcard would have handed it every
     * elprofessor route a later release adds.
     */
    public function test_the_status_write_does_not_widen_the_confinement(): void
    {
        $driver = $this->driver($this->tenant, 'Omar');
        $token = $this->mint();

        $this->postJson('/api/v1/elprofessor/submissions/status', [
            'external_submission_id' => 'sub-1',
            'external_driver_id' => $driver->id,
            'status' => 'rejected',
            'reason_code' => 'review_rejected',
        ], $this->bearer($token))->assertOk();

        $this->postJson('/api/v1/elprofessor/token', [], $this->bearer($token))->assertForbidden();
        $this->deleteJson('/api/v1/elprofessor/token', [], $this->bearer($token))->assertForbidden();
        $this->getJson('/api/v1/elprofessor/connection', $this->bearer($token))->assertForbidden();
        $this->getJson('/api/v1/drivers', $this->bearer($token))->assertForbidden();
        $this->postJson('/api/v1/drivers/roster', [], $this->bearer($token))->assertForbidden();
        $this->getJson('/api/v1/me', $this->bearer($token))->assertForbidden();
    }

    // ── The fetch (08.10.2026) ───────────────────────────────────────────────
    //
    //  El-Professor cannot be PUSHED a payload: its intake authenticates with
    //  the token this side issued, and Sanctum keeps only a hash. So it rings
    //  and El-Professor fetches. These tests are about the fetch being confined,
    //  tenant-blind across fleets, and marking what it took.

    private function submission(Tenant $tenant, Driver $driver, array $attributes = []): ElProfessorSubmission
    {
        return ElProfessorSubmission::create(array_merge([
            'tenant_id' => $tenant->id,
            'driver_id' => $driver->id,
            'subject' => 'receipt',
            'status' => ElProfessorSubmission::STATUS_PENDING,
            'payload' => ['receipt_date' => '2026-10-07', 'amount' => '41.47', 'category' => 'Tanken'],
        ], $attributes));
    }

    public function test_the_pending_list_carries_what_to_fetch_and_no_payload(): void
    {
        $token = $this->mint();
        $driver = $this->driver($this->tenant, 'Omar');
        $row = $this->submission($this->tenant, $driver);

        $body = $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/elprofessor/submissions')
            ->assertOk()
            ->json();

        $this->assertSame([$row->uuid], array_column($body['data'], 'id'));
        $this->assertSame('receipt', $body['data'][0]['subject']);
        // A list of what to fetch, not the submissions themselves: a catch-up
        // reading a hundred waiting receipts must not move a hundred photos.
        $this->assertArrayNotHasKey('amount', $body['data'][0]);
        $this->assertArrayNotHasKey('document', $body['data'][0]);
        $this->assertArrayNotHasKey('payload', $body['data'][0]);
    }

    public function test_the_pending_list_is_tenant_scoped(): void
    {
        $token = $this->mint();
        $mine = $this->submission($this->tenant, $this->driver($this->tenant, 'Mine'));
        $theirs = $this->submission($this->other, $this->driver($this->other, 'Theirs'));

        $ids = array_column(
            $this->withHeaders($this->bearer($token))
                ->getJson('/api/v1/elprofessor/submissions')->assertOk()->json('data'),
            'id',
        );

        $this->assertContains($mine->uuid, $ids);
        $this->assertNotContains($theirs->uuid, $ids);
    }

    public function test_an_unknown_status_filter_is_refused_rather_than_ignored(): void
    {
        // `status` reaches a WHERE. A value outside the allow-list answering 422
        // is what stops it being read as "everything".
        $token = $this->mint();

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/elprofessor/submissions?status=accepted')
            ->assertStatus(422);
    }

    public function test_fetching_one_submission_returns_its_fields_and_its_photo(): void
    {
        Storage::fake('local');
        $token = $this->mint();
        $driver = $this->driver($this->tenant, 'Omar');
        Storage::disk('local')->put('elprofessor/'.$this->tenant->id.'/x.jpg', 'JPEGBYTES');
        $row = $this->submission($this->tenant, $driver, [
            'document_path' => 'elprofessor/'.$this->tenant->id.'/x.jpg',
            'document_mime' => 'image/jpeg',
        ]);

        $body = $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/elprofessor/submissions/'.$row->uuid)
            ->assertOk()
            ->json('data');

        $this->assertSame('41.47', $body['amount']);
        $this->assertSame('Tanken', $body['category']);
        $this->assertSame('receipt', $body['subject']);
        $this->assertSame((string) $driver->id, $body['external_driver_id']);
        $this->assertSame($row->uuid, $body['external_submission_id']);
        $this->assertSame('JPEGBYTES', base64_decode($body['document']));
        $this->assertSame('image/jpeg', $body['content_type']);
    }

    public function test_a_photo_the_disk_does_not_have_is_ABSENT_rather_than_empty(): void
    {
        // The row names a file that is not there -- a failed write, a cleaned
        // volume. An empty string would reach El-Professor as a photo it could
        // not read; an absent field makes it refuse the submission by name.
        Storage::fake('local');
        $token = $this->mint();
        $row = $this->submission($this->tenant, $this->driver($this->tenant, 'Omar'), [
            'document_path' => 'elprofessor/'.$this->tenant->id.'/gone.jpg',
            'document_mime' => 'image/jpeg',
        ]);

        $body = $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/elprofessor/submissions/'.$row->uuid)
            ->assertOk()
            ->json('data');

        $this->assertArrayNotHasKey('document', $body);
    }

    public function test_fetching_marks_it_taken_so_a_catchup_does_not_offer_it_again(): void
    {
        Storage::fake('local');
        $token = $this->mint();
        $row = $this->submission($this->tenant, $this->driver($this->tenant, 'Omar'));

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/elprofessor/submissions/'.$row->uuid)->assertOk();

        $row->refresh();
        $this->assertSame(ElProfessorSubmission::STATUS_TAKEN, $row->status);
        $this->assertNotNull($row->fetched_at);

        $ids = array_column(
            $this->withHeaders($this->bearer($token))
                ->getJson('/api/v1/elprofessor/submissions')->assertOk()->json('data'),
            'id',
        );
        $this->assertNotContains($row->uuid, $ids);
    }

    public function test_a_submission_of_another_tenant_is_the_same_404_as_one_that_does_not_exist(): void
    {
        // The tenant is a term in the query, not a check after it, so the two
        // answers are identical BY CONSTRUCTION -- the same property the
        // rejection endpoint has, and the same reason: a caller holding one
        // fleet's token must not learn another fleet's submission ids exist.
        $token = $this->mint();
        $theirs = $this->submission($this->other, $this->driver($this->other, 'Theirs'));

        $foreign = $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/elprofessor/submissions/'.$theirs->uuid);
        $missing = $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/elprofessor/submissions/'.\Illuminate\Support\Str::uuid());

        $foreign->assertStatus(404);
        $missing->assertStatus(404);
        $this->assertSame($missing->getContent(), $foreign->getContent());

        // And it was not marked by the attempt.
        $this->assertSame(ElProfessorSubmission::STATUS_PENDING, $theirs->refresh()->status);
    }

    public function test_the_fetch_does_not_widen_the_confinement(): void
    {
        // The whole reason this file exists: an ability missing from
        // CONFINED_ABILITIES is not confined at all, so each added path is
        // tested against a route it must still not reach.
        $token = $this->mint();

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/drivers')->assertStatus(403);
        $this->withHeaders($this->bearer($token))
            ->postJson('/api/v1/elprofessor/token')->assertStatus(403);
    }

    // ── The driver's own submission ──────────────────────────────────────────

    public function test_a_driver_submits_a_receipt_with_its_photo_and_it_rings(): void
    {
        Storage::fake('local');
        Queue::fake();
        $driver = $this->driver($this->tenant, 'Omar');
        $this->actingAsDriver($driver);

        $body = $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'receipt',
            'receipt_date' => '2026-10-07',
            'amount' => '41.47',
            'category' => 'Tanken',
            'payment_method' => 'bar',
            'document' => UploadedFile::fake()->image('beleg.jpg'),
        ])->assertStatus(201)->json('data');

        $row = ElProfessorSubmission::withoutGlobalScopes()->firstWhere('uuid', $body['id']);
        $this->assertNotNull($row);
        // The driver and the fleet come off the token, never off the request.
        $this->assertSame($driver->id, (int) $row->driver_id);
        $this->assertSame($this->tenant->id, (int) $row->tenant_id);
        $this->assertSame('41.47', $row->payload['amount']);
        Storage::disk('local')->assertExists($row->document_path);

        Queue::assertPushed(RingElProfessor::class);
    }

    public function test_a_receipt_with_no_photo_is_refused_at_submission_time(): void
    {
        // It cannot be accepted on the other side either (`document_missing`),
        // so refusing it here is what lets the driver learn now rather than
        // from a rejection days later.
        Storage::fake('local');
        Queue::fake();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'receipt',
            'receipt_date' => '2026-10-07',
            'amount' => '41.47',
            'category' => 'Tanken',
        ])->assertStatus(422)->assertJsonValidationErrors('document');

        $this->assertSame(0, ElProfessorSubmission::withoutGlobalScopes()->count());
        Queue::assertNotPushed(RingElProfessor::class);
    }

    public function test_an_amount_in_german_formatting_is_refused_rather_than_coerced(): void
    {
        // El-Professor's own parser reads `1.234` as 1.23 and answers 0 for
        // anything it cannot read, and this figure reaches a driver's balance.
        Storage::fake('local');
        Queue::fake();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        foreach (['41,47', '1.234,56', '41.47 EUR', '-5.00', 'vierzig'] as $amount) {
            $this->postJson('/api/v1/driver/submissions', [
                'subject' => 'receipt',
                'receipt_date' => '2026-10-07',
                'amount' => $amount,
                'category' => 'Tanken',
                'document' => UploadedFile::fake()->image('beleg.jpg'),
            ])->assertStatus(422)->assertJsonValidationErrors('amount');
        }

        $this->assertSame(0, ElProfessorSubmission::withoutGlobalScopes()->count());
    }

    public function test_a_receipt_with_neither_category_nor_description_is_refused(): void
    {
        Storage::fake('local');
        Queue::fake();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'receipt',
            'receipt_date' => '2026-10-07',
            'amount' => '41.47',
            'document' => UploadedFile::fake()->image('beleg.jpg'),
        ])->assertStatus(422)->assertJsonValidationErrors('category');
    }

    public function test_a_driver_sees_their_own_submissions_and_the_reason_on_a_rejection(): void
    {
        Storage::fake('local');
        $driver = $this->driver($this->tenant, 'Omar');
        $mine = $this->submission($this->tenant, $driver, [
            'status' => ElProfessorSubmission::STATUS_REJECTED,
            'decision_text' => 'Foto unleserlich',
        ]);
        $other = $this->submission($this->tenant, $this->driver($this->tenant, 'Lena'));

        $this->actingAsDriver($driver);
        $body = $this->getJson('/api/v1/driver/submissions')->assertOk()->json('data');

        $this->assertSame([$mine->uuid], array_column($body, 'id'));
        $this->assertNotContains($other->uuid, array_column($body, 'id'));
        // The company's own words. Without them a rejection is something the
        // driver cannot act on.
        $this->assertSame('Foto unleserlich', $body[0]['reason']);
    }

    public function test_a_rejection_marks_the_row_as_well_as_notifying(): void
    {
        $token = $this->mint();
        $driver = $this->driver($this->tenant, 'Omar');
        $row = $this->submission($this->tenant, $driver, [
            'status' => ElProfessorSubmission::STATUS_TAKEN,
        ]);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/v1/elprofessor/submissions/status', [
                'external_submission_id' => $row->uuid,
                'external_driver_id' => $driver->id,
                'status' => 'rejected',
                'reason_code' => 'review_rejected',
                'reason_text' => 'Foto unleserlich',
                'kind' => 'receipt',
            ])->assertOk();

        $row->refresh();
        $this->assertSame(ElProfessorSubmission::STATUS_REJECTED, $row->status);
        $this->assertSame('Foto unleserlich', $row->decision_text);
        $this->assertNotNull($row->decided_at);
    }

    public function test_a_rejection_for_a_submission_this_side_does_not_know_still_notifies(): void
    {
        // The id belonged to El-Professor before this table existed, and the
        // notification is the point. An update that matched nothing must not
        // turn into a refusal.
        $token = $this->mint();
        $driver = $this->driver($this->tenant, 'Omar');

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/v1/elprofessor/submissions/status', [
                'external_submission_id' => (string) \Illuminate\Support\Str::uuid(),
                'external_driver_id' => $driver->id,
                'status' => 'rejected',
                'reason_code' => 'review_rejected',
            ])->assertOk()->assertJsonPath('data.notified', true);
    }

    public function test_a_rejection_does_not_mark_another_tenants_submission(): void
    {
        $token = $this->mint();
        $driver = $this->driver($this->tenant, 'Omar');
        $theirs = $this->submission($this->other, $this->driver($this->other, 'Theirs'), [
            'status' => ElProfessorSubmission::STATUS_TAKEN,
        ]);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/v1/elprofessor/submissions/status', [
                'external_submission_id' => $theirs->uuid,
                'external_driver_id' => $driver->id,
                'status' => 'rejected',
                'reason_code' => 'review_rejected',
            ])->assertOk();

        $this->assertSame(ElProfessorSubmission::STATUS_TAKEN, $theirs->refresh()->status);
    }

    // ── The ring ─────────────────────────────────────────────────────────────

    public function test_the_ring_carries_four_fields_and_no_payload(): void
    {
        Storage::fake('local');
        config(['elprofessor.intake_url' => 'http://intake.test/functions/v1/partner-intake']);
        config(['elprofessor.anon_key' => 'anon-key']);
        \Illuminate\Support\Facades\Http::fake(['intake.test/*' => \Illuminate\Support\Facades\Http::response(['ok' => true])]);

        $driver = $this->driver($this->tenant, 'Omar');
        $row = $this->submission($this->tenant, $driver);

        (new RingElProfessor($row->id))->handle();

        \Illuminate\Support\Facades\Http::assertSent(function ($request) use ($row) {
            $body = $request->data();
            // Four fields and nothing else: a ring that could assert an amount
            // or a driver would be a ring worth forging.
            $this->assertSame([
                'kind' => 'doorbell',
                'partner' => 'reidey',
                'fleet' => (string) $this->tenant->id,
                'submission' => $row->uuid,
                'subject' => 'receipt',
            ], $body);

            return $request->hasHeader('Authorization', 'Bearer anon-key');
        });
    }

    public function test_an_unconfigured_ring_sends_nothing_and_does_not_fail(): void
    {
        // This side is a live product whose operator may never configure the
        // link. The submission is already stored and the other side's catch-up
        // reads it, so a missing configuration delays nothing's arrival but
        // loses nothing either.
        Storage::fake('local');
        config(['elprofessor.intake_url' => null, 'elprofessor.anon_key' => null]);
        \Illuminate\Support\Facades\Http::fake();

        $row = $this->submission($this->tenant, $this->driver($this->tenant, 'Omar'));

        (new RingElProfessor($row->id))->handle();

        \Illuminate\Support\Facades\Http::assertNothingSent();
        $this->assertSame(ElProfessorSubmission::STATUS_PENDING, $row->refresh()->status);
    }

    public function test_a_submission_already_fetched_is_not_rung_again(): void
    {
        Storage::fake('local');
        config(['elprofessor.intake_url' => 'http://intake.test/x', 'elprofessor.anon_key' => 'k']);
        \Illuminate\Support\Facades\Http::fake();

        $row = $this->submission($this->tenant, $this->driver($this->tenant, 'Omar'), [
            'status' => ElProfessorSubmission::STATUS_TAKEN,
        ]);

        (new RingElProfessor($row->id))->handle();

        \Illuminate\Support\Facades\Http::assertNothingSent();
    }

    // ── The rejection is TOLD, not only stored ───────────────────────────────
    //
    //  `AppNotification::via()` is `['database']` and the driver's app has no
    //  endpoint that reads those rows, so without a push a rejection is what a
    //  driver finds whenever they next happen to look.

    /** A sender that records what it was asked to send and can be made to fail. */
    private function fakePush(bool $throw = false): object
    {
        $sender = new class($throw) implements PushSender
        {
            /** @var array<int, array{token: string, title: string, body: string, data: array<string, mixed>}> */
            public array $sent = [];

            public function __construct(private bool $throw) {}

            public function send(string $deviceToken, string $title, string $body, array $data = []): bool
            {
                if ($this->throw) {
                    throw new \RuntimeException('transport down');
                }
                $this->sent[] = compact('deviceToken', 'title', 'body', 'data');

                return true;
            }
        };
        $this->app->instance(PushSender::class, $sender);

        return $sender;
    }

    public function test_a_rejection_pushes_to_the_drivers_devices_on_its_own_channel(): void
    {
        $sender = $this->fakePush();
        $token = $this->mint();
        $driver = $this->driver($this->tenant, 'Omar');
        DeviceToken::create([
            'tenant_id' => $this->tenant->id, 'driver_id' => $driver->id,
            'token' => 'device-1', 'platform' => 'android',
        ]);
        $row = $this->submission($this->tenant, $driver, [
            'status' => ElProfessorSubmission::STATUS_TAKEN,
        ]);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/v1/elprofessor/submissions/status', [
                'external_submission_id' => $row->uuid,
                'external_driver_id' => $driver->id,
                'status' => 'rejected',
                'reason_code' => 'review_rejected',
                'reason_text' => 'Foto unleserlich',
                'kind' => 'receipt',
            ])->assertOk();

        $this->assertCount(1, $sender->sent);
        $push = $sender->sent[0];
        $this->assertSame('device-1', $push['token'] ?? $push['deviceToken']);
        // The reviewer's own words are the body: a push that says only
        // "something was rejected" makes the driver open the app to learn
        // nothing they could not have been told.
        $this->assertSame('Foto unleserlich', $push['body']);
        // The app routes on this and opens the submissions screen.
        $this->assertSame('elprofessor.submission_rejected', $push['data']['type']);
        $this->assertSame('receipt', $push['data']['kind']);
        // Its own channel: an offer expires in minutes and owns the loudest one.
        $this->assertSame('documents', $push['data']['channel_id']);
    }

    public function test_a_push_that_cannot_go_does_not_fail_the_decision(): void
    {
        // The decision is already recorded by then. A 500 here would have
        // El-Professor retry a decision that was taken.
        $this->fakePush(throw: true);
        $token = $this->mint();
        $driver = $this->driver($this->tenant, 'Omar');
        DeviceToken::create([
            'tenant_id' => $this->tenant->id, 'driver_id' => $driver->id,
            'token' => 'device-1', 'platform' => 'android',
        ]);
        $row = $this->submission($this->tenant, $driver, [
            'status' => ElProfessorSubmission::STATUS_TAKEN,
        ]);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/v1/elprofessor/submissions/status', [
                'external_submission_id' => $row->uuid,
                'external_driver_id' => $driver->id,
                'status' => 'rejected',
                'reason_code' => 'review_rejected',
                'reason_text' => 'Foto unleserlich',
            ])->assertOk();

        $this->assertSame(ElProfessorSubmission::STATUS_REJECTED, $row->refresh()->status);
    }

    public function test_a_driver_with_no_device_is_simply_not_pushed(): void
    {
        $sender = $this->fakePush();
        $token = $this->mint();
        $driver = $this->driver($this->tenant, 'Omar');
        $row = $this->submission($this->tenant, $driver, [
            'status' => ElProfessorSubmission::STATUS_TAKEN,
        ]);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/v1/elprofessor/submissions/status', [
                'external_submission_id' => $row->uuid,
                'external_driver_id' => $driver->id,
                'status' => 'rejected',
                'reason_code' => 'review_rejected',
            ])->assertOk();

        $this->assertSame([], $sender->sent);
        // And the list still carries it, which is the other half of the telling.
        $this->assertSame(ElProfessorSubmission::STATUS_REJECTED, $row->refresh()->status);
    }
}
