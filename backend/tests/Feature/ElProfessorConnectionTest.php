<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Domain\Fleet\Models\Vehicle;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Http\Controllers\Api\V1\ElProfessorController;
use App\Jobs\RingElProfessor;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
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

    /**
     * Mint a token, opening the integration first.
     *
     * The platform's switch defaults to OFF, so every test that mints has to
     * open it — which is the real order of events: the operator opens the
     * company, then the company connects. `openIntegration()` is separate so a
     * test can assert what a CLOSED company cannot do.
     */
    private function mint(): string
    {
        $this->openIntegration();
        Sanctum::actingAs($this->manager, ['*']);

        return $this->postJson('/api/v1/elprofessor/token')->assertOk()->json('data.token');
    }

    private function openIntegration(?Tenant $tenant = null): void
    {
        ($tenant ?? $this->tenant)->setElprofessorEnabled(true);
    }

    /**
     * Connect the company for real: mint a token and let El-Professor use it
     * once, which is what sets `first_used_at` and makes `connected` true.
     *
     * Flipping the settings by hand would test a different thing -- these five
     * submission tests exist to prove the driver's own door, and they must
     * reach it the way a real driver does.
     */
    private function connectCompany(): void
    {
        $token = $this->mint();
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/elprofessor/fleet')->assertOk();
        $this->app['auth']->forgetGuards();
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
        // The platform's switch defaults to off, so a company is opened before
        // it can mint — the real order of events.
        $this->openIntegration();
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

    public function test_a_photo_the_disk_does_not_have_is_absen_t_rather_than_empty(): void
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
        // answers are identical BY CONSTRUCTION: a caller holding one fleet's
        // token must not learn another fleet's submission ids exist. (The
        // status route that carried the same property for a driver id is
        // gone; this is the one enumeration surface left on the token.)
        $token = $this->mint();
        $theirs = $this->submission($this->other, $this->driver($this->other, 'Theirs'));

        $foreign = $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/elprofessor/submissions/'.$theirs->uuid);
        $missing = $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/elprofessor/submissions/'.Str::uuid());

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
        $this->withHeaders($this->bearer($token))
            ->deleteJson('/api/v1/elprofessor/token')->assertStatus(403);
        $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/elprofessor/connection')->assertStatus(403);
        $this->withHeaders($this->bearer($token))
            ->postJson('/api/v1/drivers/roster')->assertStatus(403);
        $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/me')->assertStatus(403);
    }

    public function test_the_token_has_no_write_left(): void
    {
        // The token's ONE write, the status route, was removed on 13.10.2026.
        // Its CONFINED_ABILITIES entry went with it, so the ability is read-only
        // again and the path is refused rather than served.
        $driver = $this->driver($this->tenant, 'Omar');
        $token = $this->mint();
        $row = $this->submission($this->tenant, $driver, [
            'status' => ElProfessorSubmission::STATUS_TAKEN,
        ]);

        $response = $this->withHeaders($this->bearer($token))
            ->postJson('/api/v1/elprofessor/submissions/status', [
                'external_submission_id' => $row->uuid,
                'external_driver_id' => $driver->id,
                'status' => 'rejected',
                'reason_code' => 'review_rejected',
            ]);

        $this->assertContains($response->getStatusCode(), [403, 404, 405]);
        $this->assertSame(ElProfessorSubmission::STATUS_TAKEN, $row->refresh()->status);
    }

    // ── The driver's own submission ──────────────────────────────────────────

    public function test_a_driver_submits_a_receipt_with_its_photo_and_it_rings(): void
    {
        Storage::fake('local');
        Queue::fake();
        $this->connectCompany();
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

    public function test_a_receipt_with_no_photo_is_accepted_and_still_rings(): void
    {
        // This test used to assert the opposite. The owner decided on
        // 10.10.2026 that a driver sends the FIGURES and not the document: the
        // app photographs the receipt, reads it with the phone's own OCR, and
        // keeps the image. So a submission with no document is the normal shape
        // from a current build, and refusing it would refuse every one of them.
        Storage::fake('local');
        Queue::fake();
        $this->connectCompany();
        $driver = $this->driver($this->tenant, 'Omar');
        $this->actingAsDriver($driver);

        $body = $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'receipt',
            'receipt_date' => '2026-10-07',
            'amount' => '41.47',
            'category' => 'Tanken',
            'payment_method' => 'bar',
        ])->assertStatus(201)->json('data');

        $row = ElProfessorSubmission::withoutGlobalScopes()->firstWhere('uuid', $body['id']);
        $this->assertNotNull($row);
        $this->assertNull($row->document_path);
        $this->assertNull($row->document_mime);
        $this->assertNull($row->document_bytes);
        $this->assertSame('41.47', $row->payload['amount']);

        Queue::assertPushed(RingElProfessor::class);
    }

    public function test_a_receipt_with_a_photo_is_still_accepted_from_an_older_app(): void
    {
        // There is no store update that reaches every phone at once, so builds
        // from before 10.10.2026 keep sending the image. Both shapes have to
        // work at the same time, and this is the half that is easy to lose when
        // someone later "tidies up" the now-optional rule into a refusal.
        Storage::fake('local');
        Queue::fake();
        $this->connectCompany();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $body = $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'receipt',
            'receipt_date' => '2026-10-07',
            'amount' => '41.47',
            'category' => 'Tanken',
            'payment_method' => 'bar',
            'document' => UploadedFile::fake()->image('beleg.jpg'),
        ])->assertStatus(201)->json('data');

        $row = ElProfessorSubmission::withoutGlobalScopes()->firstWhere('uuid', $body['id']);
        $this->assertNotNull($row->document_path);
        Storage::disk('local')->assertExists($row->document_path);
    }

    public function test_a_refuel_carries_the_odometer_and_the_range_into_the_payload(): void
    {
        // Both figures are read on the phone from a photo of the cluster that
        // never leaves it, so the payload is the only record of them.
        Storage::fake('local');
        Queue::fake();
        $this->connectCompany();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $body = $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'receipt',
            'receipt_date' => '2026-10-07',
            'amount' => '41.47',
            'category' => 'Tanken',
            'payment_method' => 'bar',
            'merchant_name' => 'ARAL Tankstelle',
            'city' => 'Berlin',
            'receipt_time' => '14:32',
            'litres' => '41.47',
            'price_per_litre' => '1.789',
            'odometer_km' => '25382',
            'range_km' => '277',
        ])->assertStatus(201)->json('data');

        $row = ElProfessorSubmission::withoutGlobalScopes()->firstWhere('uuid', $body['id']);
        $this->assertNotNull($row);

        // Strings, every one, because this payload is merged into the fetch
        // response verbatim and the other side reads strings or nothing.
        $this->assertSame('25382', $row->payload['odometer_km']);
        $this->assertSame('277', $row->payload['range_km']);
        $this->assertSame('41.47', $row->payload['litres']);
        $this->assertSame('1.789', $row->payload['price_per_litre']);
        $this->assertSame('ARAL Tankstelle', $row->payload['merchant_name']);
        $this->assertSame('14:32', $row->payload['receipt_time']);
    }

    public function test_a_bare_number_odometer_is_refused_rather_than_stored_as_one(): void
    {
        // This is the silent-loss case, and it is why the rule says `string`.
        // The payload reaches El-Professor verbatim; its parser answers null
        // for a non-string, so a numeric odometer would vanish between a 201
        // here and a 200 there, on the one field the owner made MANDATORY.
        Storage::fake('local');
        Queue::fake();
        $this->connectCompany();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'receipt',
            'receipt_date' => '2026-10-07',
            'amount' => '41.47',
            'category' => 'Tanken',
            'odometer_km' => 25382,
        ])->assertStatus(422)->assertJsonValidationErrors('odometer_km');

        $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'receipt',
            'receipt_date' => '2026-10-07',
            'amount' => '41.47',
            'category' => 'Tanken',
            'range_km' => 277,
        ])->assertStatus(422)->assertJsonValidationErrors('range_km');

        $this->assertSame(0, ElProfessorSubmission::withoutGlobalScopes()->count());
    }

    public function test_the_odometer_bounds_are_numeric_and_not_string_lengths(): void
    {
        // With both `string` and `integer` on one field, Laravel could size
        // `min`/`max` either way. It sizes numerically because `getSize()`
        // checks the numeric rules first - and that is measured here rather
        // than taken on trust, because if it sized by LENGTH then `min:1000`
        // would refuse every real odometer ever sent.
        Storage::fake('local');
        Queue::fake();
        $this->connectCompany();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $send = function (array $extra) {
            return $this->postJson('/api/v1/driver/submissions', array_merge([
                'subject' => 'receipt',
                'receipt_date' => '2026-10-07',
                'amount' => '41.47',
                'category' => 'Tanken',
            ], $extra));
        };

        // Five digits, well under a length bound of 1000 and well over a
        // numeric one: accepted only if the bound is numeric.
        $send(['odometer_km' => '25382'])->assertStatus(201);
        // Three digits: a range or a trip meter, which is the confusion the
        // app's own rule exists to refuse. Numerically below the floor.
        $send(['odometer_km' => '691'])->assertStatus(422)
            ->assertJsonValidationErrors('odometer_km');
        // Eight digits: over the ceiling numerically, under it by length.
        $send(['odometer_km' => '99999999'])->assertStatus(422)
            ->assertJsonValidationErrors('odometer_km');
        // Zero range is a real reading and must survive a `min:0`.
        $send(['range_km' => '0'])->assertStatus(201);
        $send(['range_km' => '2001'])->assertStatus(422)
            ->assertJsonValidationErrors('range_km');
    }

    public function test_a_decimal_odometer_is_refused_because_a_cluster_shows_none(): void
    {
        Storage::fake('local');
        Queue::fake();
        $this->connectCompany();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        foreach (['25382.0', '25382,0', '25382 km', '-25382', '2 5382'] as $value) {
            $this->postJson('/api/v1/driver/submissions', [
                'subject' => 'receipt',
                'receipt_date' => '2026-10-07',
                'amount' => '41.47',
                'category' => 'Tanken',
                'odometer_km' => $value,
            ])->assertStatus(422)->assertJsonValidationErrors('odometer_km');
        }

        $this->assertSame(0, ElProfessorSubmission::withoutGlobalScopes()->count());
    }

    public function test_a_receipt_that_is_not_a_refuel_needs_neither_figure(): void
    {
        // The app demands the odometer on `Tanken` only; a car wash has no
        // cluster photo to read, and a rule here would refuse every one.
        Storage::fake('local');
        Queue::fake();
        $this->connectCompany();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $body = $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'receipt',
            'receipt_date' => '2026-10-07',
            'amount' => '60.00',
            'category' => 'Autowäsche',
        ])->assertStatus(201)->json('data');

        $row = ElProfessorSubmission::withoutGlobalScopes()->firstWhere('uuid', $body['id']);
        $this->assertArrayNotHasKey('odometer_km', $row->payload);
        $this->assertArrayNotHasKey('range_km', $row->payload);
    }

    public function test_an_amount_in_german_formatting_is_refused_rather_than_coerced(): void
    {
        // El-Professor's own parser reads `1.234` as 1.23 and answers 0 for
        // anything it cannot read, and this figure reaches a driver's balance.
        Storage::fake('local');
        Queue::fake();
        $this->connectCompany();
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
        $this->connectCompany();
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
        $this->connectCompany();
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

    public function test_the_list_carries_a_whitelisted_detail_for_a_receipt_and_for_a_note(): void
    {
        Storage::fake('local');
        $this->connectCompany();
        $driver = $this->driver($this->tenant, 'Omar');
        $this->submission($this->tenant, $driver, [
            'created_at' => now()->subMinute(),
            'payload' => [
                'receipt_date' => '2026-10-07', 'amount' => '41.47', 'category' => 'Tanken',
                'merchant_name' => 'Aral', 'litres' => '30.10', 'odometer_km' => '25382', 'range_km' => '410',
            ],
        ]);
        $this->submission($this->tenant, $driver, [
            'subject' => 'note',
            'payload' => ['note_type' => 'blitzer', 'note_text' => 'Radar an der B1', 'vehicle_plate' => 'B-AB 123'],
        ]);

        $this->actingAsDriver($driver);
        $bySubject = collect($this->getJson('/api/v1/driver/submissions')->assertOk()->json('data'))
            ->keyBy('subject');

        $this->assertSame([
            'amount' => '41.47', 'category' => 'Tanken', 'merchant_name' => 'Aral',
        ], $bySubject['receipt']['detail']);
        // The fuel readings and the odometer stay out: the list has no use for them.
        $this->assertSame([
            'note_type' => 'blitzer', 'note_text' => 'Radar an der B1', 'vehicle_plate' => 'B-AB 123',
        ], $bySubject['note']['detail']);
    }

    // ── The ring ─────────────────────────────────────────────────────────────

    public function test_the_ring_carries_four_fields_and_no_payload(): void
    {
        Storage::fake('local');
        config(['elprofessor.intake_url' => 'http://intake.test/functions/v1/partner-intake']);
        config(['elprofessor.anon_key' => 'anon-key']);
        Http::fake(['intake.test/*' => Http::response(['ok' => true])]);

        $driver = $this->driver($this->tenant, 'Omar');
        $row = $this->submission($this->tenant, $driver);

        (new RingElProfessor($row->id))->handle();

        Http::assertSent(function ($request) use ($row) {
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
        Http::fake();

        $row = $this->submission($this->tenant, $this->driver($this->tenant, 'Omar'));

        (new RingElProfessor($row->id))->handle();

        Http::assertNothingSent();
        $this->assertSame(ElProfessorSubmission::STATUS_PENDING, $row->refresh()->status);
    }

    public function test_a_submission_already_fetched_is_not_rung_again(): void
    {
        Storage::fake('local');
        config(['elprofessor.intake_url' => 'http://intake.test/x', 'elprofessor.anon_key' => 'k']);
        Http::fake();

        $row = $this->submission($this->tenant, $this->driver($this->tenant, 'Omar'), [
            'status' => ElProfessorSubmission::STATUS_TAKEN,
        ]);

        (new RingElProfessor($row->id))->handle();

        Http::assertNothingSent();
    }

    // ── A company that is not connected submits nothing ──────────────────────
    //
    //  `documents_enabled` is `Tenant::isElprofessorConnected()`: a live
    //  `elprofessor` token, not revoked, AND El-Professor has actually used it
    //  at least once. Until all three hold there is nobody to fetch a
    //  submission, so one stored would sit unread while the driver believed it
    //  had gone. The app hides the section on the same flag; this is the wall.

    public function test_a_driver_of_an_unconnected_company_cannot_submit(): void
    {
        // The tenant in setUp has never issued a token, so it is not connected.
        Storage::fake('local');
        Queue::fake();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'receipt',
            'receipt_date' => '2026-10-07',
            'amount' => '41.47',
            'category' => 'Tanken',
            'document' => UploadedFile::fake()->image('beleg.jpg'),
        ])->assertStatus(403)->assertJsonPath('reason', 'not_connected');

        $this->assertSame(0, ElProfessorSubmission::withoutGlobalScopes()->count());
        Queue::assertNotPushed(RingElProfessor::class);
    }

    public function test_a_driver_of_an_unconnected_company_cannot_list_either(): void
    {
        // The list is refused too, so a stale screen says why rather than
        // showing an empty list that reads as "you have sent nothing".
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $this->getJson('/api/v1/driver/submissions')
            ->assertStatus(403)
            ->assertJsonPath('reason', 'not_connected');
    }

    public function test_a_token_that_was_never_used_is_not_connected_enough(): void
    {
        // Minting alone is not a connection: `connected` also needs
        // `first_used_at`, which only El-Professor's own first read sets. A
        // company that pasted nothing anywhere would otherwise look ready.
        Storage::fake('local');
        Queue::fake();
        $this->mint();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $this->getJson('/api/v1/driver/submissions')
            ->assertStatus(403)
            ->assertJsonPath('reason', 'not_connected');
    }

    public function test_once_el_professor_has_pulled_the_driver_can_submit(): void
    {
        Storage::fake('local');
        Queue::fake();
        $token = $this->mint();
        // El-Professor's first read is what flips `first_used_at`.
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/elprofessor/fleet')->assertOk();

        $driver = $this->driver($this->tenant, 'Omar');
        $this->actingAsDriver($driver);

        $this->getJson('/api/v1/driver/submissions')->assertOk();
        $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'note',
            'note_type' => 'breakdown',
            'vehicle_plate' => 'B-XX 1234',
            'note_text' => 'Panne auf der A100',
        ])->assertStatus(201);

        $this->assertSame(1, ElProfessorSubmission::withoutGlobalScopes()->count());
    }

    public function test_revoking_the_connection_closes_the_door_again(): void
    {
        // A company that revokes stops receiving submissions immediately, even
        // from an app that still shows the section from an older profile read.
        Storage::fake('local');
        Queue::fake();
        $token = $this->mint();
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/elprofessor/fleet')->assertOk();

        Sanctum::actingAs($this->manager, ['*']);
        $this->deleteJson('/api/v1/elprofessor/token')->assertOk();

        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));
        $this->getJson('/api/v1/driver/submissions')
            ->assertStatus(403)
            ->assertJsonPath('reason', 'not_connected');
    }

    public function test_an_owner_is_never_told_they_may_submit_documents(): void
    {
        // The company IS connected here — that is the point. `documents_enabled`
        // answers "may this ACCOUNT submit", not "is the company connected", and
        // an owner has no company above them to send a Beleg to. Reporting the
        // company's state put the floating button and the Profil row on the
        // owner's phone. Both payloads are asserted because they answer different
        // moments — the login and the app's resume refresh — and a disagreement
        // would make the button come and go depending on which ran last.
        $this->connectCompany();

        // A FRESH User, exactly as `actingAsDriver` re-fetches its driver. The
        // instance held from setUp has already had `tenant` lazy-loaded by the
        // mint, so `loadMissing('tenant')` is a no-op on it and the controller
        // would read a pre-connection snapshot — the test would then pass against
        // the OLD code too, proving nothing. A real request builds the user from
        // the database on every call.
        Sanctum::actingAs(User::findOrFail($this->manager->id), ['*']);
        $this->getJson('/api/v1/driver/fleet/me')
            ->assertOk()
            ->assertJsonPath('data.is_owner', true)
            ->assertJsonPath('data.documents_enabled', false)
            ->assertJsonPath('data.gallery_import_enabled', false);

        // The same company still enables it for an actual driver, so this is a
        // rule about the ACCOUNT and not the connection being switched off.
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));
        $this->getJson('/api/v1/driver/me')
            ->assertOk()
            ->assertJsonPath('data.documents_enabled', true);
    }

    public function test_the_profile_carries_the_flag_the_app_gates_on(): void
    {
        // The app hides the Profil row on exactly this field, so a rename here
        // would silently hide the section for everyone.
        $token = $this->mint();
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/elprofessor/fleet')->assertOk();

        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));
        $this->getJson('/api/v1/driver/me')
            ->assertOk()
            ->assertJsonPath('data.documents_enabled', true);
    }

    // ── The platform's per-company switch ────────────────────────────────────
    //
    //  The operator opens the integration one company at a time, and **closing
    //  it ENDS the connection** rather than pausing it (owner, 09.10.2026).

    public function test_a_company_is_closed_until_the_platform_opens_it(): void
    {
        // Absent means off, so every company that existed before the switch
        // starts closed — the safe direction, and the owner's intent.
        $this->assertFalse($this->tenant->elprofessorEnabled());

        Sanctum::actingAs($this->manager, ['*']);
        $this->postJson('/api/v1/elprofessor/token')
            ->assertStatus(403)
            ->assertJsonPath('reason', 'integration_disabled');
    }

    public function test_the_card_still_reads_its_state_while_closed(): void
    {
        // The company's own card is deliberately NOT behind the switch: it has
        // to answer so the screen can say "not enabled" instead of failing.
        Sanctum::actingAs($this->manager, ['*']);

        $this->getJson('/api/v1/elprofessor/connection')
            ->assertOk()
            ->assertJsonPath('data.enabled', false)
            ->assertJsonPath('data.connected', false);
    }

    public function test_closing_ends_a_live_connection_and_the_token_dies(): void
    {
        $token = $this->mint();
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/elprofessor/fleet')->assertOk();
        $this->assertTrue($this->tenant->refresh()->isElprofessorConnected());

        // The platform closes the company.
        $this->tenant->setElprofessorEnabled(false);

        // The old token is gone, so the very next read is refused — this is
        // what "ends" means, as opposed to "is paused".
        $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/elprofessor/fleet')
            ->assertStatus(401);

        $this->assertFalse($this->tenant->refresh()->isElprofessorConnected());
        $this->assertSame(0, $this->tenant->elprofessorTokens()->count());
    }

    public function test_the_drivers_section_disappears_when_the_company_is_closed(): void
    {
        $this->mint();
        $this->withHeaders($this->bearer($this->mint()))->getJson('/api/v1/elprofessor/fleet')->assertOk();
        $driver = $this->driver($this->tenant, 'Omar');

        $this->actingAsDriver($driver);
        $this->getJson('/api/v1/driver/me')->assertOk()->assertJsonPath('data.documents_enabled', true);

        $this->tenant->setElprofessorEnabled(false);

        // The app hides the section on this field, and the door refuses too.
        $this->actingAsDriver($driver);
        $this->getJson('/api/v1/driver/me')->assertOk()->assertJsonPath('data.documents_enabled', false);
        $this->getJson('/api/v1/driver/submissions')
            ->assertStatus(403)
            ->assertJsonPath('reason', 'not_connected');
    }

    public function test_reopening_gives_back_the_switch_and_nothing_else(): void
    {
        $token = $this->mint();
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/elprofessor/fleet')->assertOk();
        $this->tenant->setElprofessorEnabled(false);

        $this->tenant->setElprofessorEnabled(true);

        // Open again, but NOT connected: the old token stays dead, so the
        // company must issue a new one and paste it. A re-link is a deliberate
        // act with a record, not something a toggle restores silently.
        $this->assertTrue($this->tenant->refresh()->elprofessorEnabled());
        $this->assertFalse($this->tenant->isElprofessorConnected());
        $this->withHeaders($this->bearer($token))
            ->getJson('/api/v1/elprofessor/fleet')
            ->assertStatus(401);
    }

    public function test_only_a_super_admin_moves_the_switch(): void
    {
        // It is the platform's call, not the company's: a fleet manager holds
        // `connections.manage` and still cannot open their own company.
        Sanctum::actingAs($this->manager, ['*']);
        $this->patchJson("/api/v1/admin/companies/{$this->tenant->id}/elprofessor", ['enabled' => true])
            ->assertStatus(403);

        $this->assertFalse($this->tenant->refresh()->elprofessorEnabled());
    }

    public function test_the_switch_moves_one_company_and_not_its_neighbour(): void
    {
        $admin = $this->user('super_admin', 'sa@ya.de', $this->tenant);
        Sanctum::actingAs($admin, ['*']);

        $this->patchJson("/api/v1/admin/companies/{$this->tenant->id}/elprofessor", ['enabled' => true])
            ->assertOk()
            ->assertJsonPath('data.elprofessor_enabled', true)
            ->assertJsonPath('data.elprofessor_connected', false);

        $this->assertTrue($this->tenant->refresh()->elprofessorEnabled());
        $this->assertFalse($this->other->refresh()->elprofessorEnabled());
    }

    // ── Uber earnings, pulled for El-Professor ───────────────────────────────

    private function uberSession(Tenant $tenant, array $overrides = []): UberFleetSession
    {
        return UberFleetSession::withoutGlobalScopes()->create($overrides + [
            'tenant_id' => $tenant->id, 'uber_org_uuid' => 'org-'.$tenant->id,
            'cookies' => [['name' => 'sid', 'value' => 'ramen']],
            'supplier_cookies' => [['name' => 'sid', 'value' => 'hub'], ['name' => 'csid', 'value' => '2']],
            'status' => UberFleetSession::STATUS_ACTIVE,
        ]);
    }

    private function withProxy(Tenant $tenant): void
    {
        $tenant->forceFill(['proxy_url' => 'http://user:pw@proxy.test:8080'])->save();
    }

    private function earner(string $uuid, int $fareE5, int $tipE5, int $cashE5, int $netE5): array
    {
        return [
            'earnerUuid' => $uuid,
            'tripInfos' => [['tripAttributeName' => 'TRIP_ATTRIBUTE_NAME_COUNT', 'value' => '67']],
            'netOutstanding' => ['amountE5' => (string) $netE5, 'currencyCode' => 'EUR'],
            'earnings' => ['categoryName' => 'earnings', 'amount' => ['amountE5' => (string) ($fareE5 + $tipE5)], 'children' => [
                ['categoryName' => 'fare', 'amount' => ['amountE5' => (string) $fareE5]],
                ['categoryName' => 'tip', 'amount' => ['amountE5' => (string) $tipE5]],
            ]],
            'payouts' => ['categoryName' => 'payouts', 'amount' => ['amountE5' => (string) -$cashE5], 'children' => [
                ['categoryName' => 'cash_collected', 'amount' => ['amountE5' => (string) -$cashE5]],
            ]],
        ];
    }

    /** A second Http::fake() in one test is ignored (the first stub wins), so start clean. */
    private function refake(array $stubs): void
    {
        app()->forgetInstance(Factory::class);
        Http::clearResolvedInstances();
        Http::fake($stubs);
    }

    private function hubPage(array $earners, ?string $next): array
    {
        return ['data' => ['getEarnerBreakdownsV2' => [
            'earnerEarningsBreakdowns' => $earners, 'pageInfo' => ['nextPageToken' => $next],
        ]]];
    }

    private function pullEarnings(string $token, string $query = 'from=2026-10-06&to=2026-10-12')
    {
        return $this->withHeaders($this->bearer($token))->getJson('/api/v1/elprofessor/earnings?'.$query);
    }

    public function test_earnings_come_back_per_driver_as_strings_across_pages(): void
    {
        $token = $this->mint();
        $this->uberSession($this->tenant);
        $this->withProxy($this->tenant);
        $ahmed = $this->driver($this->tenant, 'Ahmed');
        $ahmed->forceFill(['uber_driver_uuid' => 'u-ahmed'])->save();
        $omar = $this->driver($this->tenant, 'Omar');
        $omar->forceFill(['uber_driver_uuid' => 'u-omar'])->save();

        Http::fake(['*/graphql' => Http::sequence()
            ->push($this->hubPage([$this->earner('u-ahmed', 66_419_000, 2_800_000, 22_626_000, 46_593_000)], 'page-2'))
            ->push($this->hubPage([
                $this->earner('u-omar', 10_000_000, 0, 0, 10_000_000),
                $this->earner('u-stranger', 1_000_000, 0, 0, 1_000_000),
            ], null)),
        ]);

        $response = $this->pullEarnings($token)->assertOk();

        $response->assertJsonPath('meta.driver_count', 2)->assertJsonPath('meta.unmatched_count', 1);
        $row = $response->json('data.drivers.0');
        $this->assertSame($ahmed->id, $row['driver_id']);
        $this->assertSame('u-ahmed', $row['uber_driver_uuid']);
        $this->assertSame('664.19', $row['fare']);
        $this->assertSame('28.00', $row['tips']);
        $this->assertSame('226.26', $row['cash']);
        $this->assertSame('465.93', $row['net_outstanding']);
        $this->assertSame('0.00', $row['promotion']);
        $this->assertSame(67, $row['trips']);
        // (664.19 + 28.00) - 226.26 = 465.93; Uber says 465.93.
        $this->assertSame('0.00', $row['difference']);
        $this->assertSame('EUR', $response->json('data.currency'));
        $this->assertSame('2026-10-06', $response->json('data.from'));
        // No money is a JSON number: the raw body carries them quoted.
        $this->assertStringContainsString('"fare":"664.19"', $response->getContent());

        // Two pages were asked for, the second with the token of the first, the
        // jar and the CSRF header on both.
        Http::assertSentCount(2);
        Http::assertSent(fn ($r) => $r['operationName'] === 'getEarnerBreakdownsV2'
            && $r['variables']['pageOptions']['pageToken'] === 'page-2'
            && $r['variables']['supplierUuid'] === 'org-'.$this->tenant->id
            && $r->hasHeader('x-csrf-token', 'x')
            && $r->hasHeader('cookie', 'sid=hub; csid=2'));
    }

    public function test_an_unmatched_earner_is_named_not_just_counted_and_carries_no_money(): void
    {
        $token = $this->mint();
        $this->uberSession($this->tenant);
        $this->withProxy($this->tenant);
        $stranger = $this->earner('u-stranger', 5_000_000, 0, 0, 5_000_000);
        $stranger['earnerMetadata'] = ['name' => 'Ahmed Hemaid'];
        Http::fake(['*/graphql' => Http::response($this->hubPage([$stranger], null))]);

        $response = $this->pullEarnings($token)->assertOk();

        $response->assertJsonPath('meta.unmatched_count', 1)
            ->assertJsonPath('meta.unmatched_truncated', false)
            ->assertJsonPath('meta.unmatched.0.name', 'Ahmed Hemaid')
            ->assertJsonPath('meta.unmatched.0.uber_driver_uuid', 'u-stranger')
            ->assertJsonPath('meta.unmatched.0.trips', 67);
        $this->assertSame(['name', 'trips', 'uber_driver_uuid'], collect($response->json('meta.unmatched.0'))->keys()->sort()->values()->all());
        $this->assertSame([], $response->json('data.drivers'));
    }

    public function test_the_unmatched_list_is_capped_but_the_count_is_not(): void
    {
        $token = $this->mint();
        $this->uberSession($this->tenant);
        $this->withProxy($this->tenant);
        $earners = [];
        for ($i = 0; $i < 105; $i++) {
            $earners[] = $this->earner("u-$i", 1_000_000, 0, 0, 1_000_000);
        }
        Http::fake(['*/graphql' => Http::response($this->hubPage($earners, null))]);

        $response = $this->pullEarnings($token)->assertOk();

        $response->assertJsonPath('meta.unmatched_count', 105)->assertJsonPath('meta.unmatched_truncated', true);
        $this->assertCount(100, $response->json('meta.unmatched'));
    }

    public function test_another_fleets_driver_with_the_same_uber_uuid_is_never_returned(): void
    {
        $token = $this->mint();
        $this->uberSession($this->tenant);
        $this->withProxy($this->tenant);
        $theirs = $this->driver($this->other, 'Theirs');
        $theirs->forceFill(['uber_driver_uuid' => 'shared-uuid'])->save();

        Http::fake(['*/graphql' => Http::response($this->hubPage([$this->earner('shared-uuid', 1_000_000, 0, 0, 1_000_000)], null))]);

        $this->pullEarnings($token)->assertOk()
            ->assertJsonPath('meta.driver_count', 0)->assertJsonPath('meta.unmatched_count', 1)
            ->assertJsonPath('data.drivers', []);
    }

    public function test_another_fleets_session_is_not_used(): void
    {
        $token = $this->mint();
        $this->uberSession($this->other);
        $this->withProxy($this->tenant);
        Http::fake();

        $this->pullEarnings($token)->assertStatus(409)->assertJsonPath('reason', 'no_uber_session');
        Http::assertNothingSent();
    }

    public function test_without_a_proxy_nothing_is_sent_to_uber(): void
    {
        $token = $this->mint();
        $this->uberSession($this->tenant);
        Http::fake();

        $this->pullEarnings($token)->assertStatus(409)->assertJsonPath('reason', 'no_proxy');
        Http::assertNothingSent();
    }

    public function test_an_expired_session_and_a_rejected_one_are_told_apart_from_an_outage(): void
    {
        $token = $this->mint();
        $session = $this->uberSession($this->tenant, ['status' => UberFleetSession::STATUS_NEEDS_RELINK]);
        $this->withProxy($this->tenant);
        Http::fake();
        $this->pullEarnings($token)->assertStatus(409)->assertJsonPath('reason', 'no_uber_session');

        $session->forceFill(['status' => UberFleetSession::STATUS_ACTIVE])->save();
        $this->refake(['*/graphql' => Http::response('', 401)]);
        $this->pullEarnings($token)->assertStatus(409)->assertJsonPath('reason', 'uber_session_rejected');

        $this->refake(['*/graphql' => Http::response('', 503)]);
        $this->pullEarnings($token)->assertStatus(502)->assertJsonPath('reason', 'uber_error');
    }

    public function test_a_graphql_error_or_an_unreadable_amount_is_a_failure_not_a_zero(): void
    {
        $token = $this->mint();
        $this->uberSession($this->tenant);
        $this->withProxy($this->tenant);
        $this->driver($this->tenant, 'Ahmed')->forceFill(['uber_driver_uuid' => 'u-ahmed'])->save();

        Http::fake(['*/graphql' => Http::response(['errors' => [['message' => 'nope']]])]);
        $this->pullEarnings($token)->assertStatus(502)->assertJsonPath('reason', 'uber_graphql_error');

        $bad = $this->earner('u-ahmed', 1, 0, 0, 1);
        $bad['netOutstanding']['amountE5'] = '12.5';
        $this->refake(['*/graphql' => Http::response($this->hubPage([$bad], null))]);
        $this->pullEarnings($token)->assertStatus(502)->assertJsonPath('reason', 'unreadable_amount');
    }

    public function test_a_pagination_that_never_ends_is_refused_rather_than_cut_short(): void
    {
        $token = $this->mint();
        $this->uberSession($this->tenant);
        $this->withProxy($this->tenant);
        $n = 0;
        Http::fake(['*/graphql' => function () use (&$n) {
            return Http::response($this->hubPage([], 'p'.++$n));
        }]);

        $this->pullEarnings($token)->assertStatus(502)->assertJsonPath('reason', 'too_many_pages');
    }

    public function test_the_range_is_validated(): void
    {
        $token = $this->mint();
        Http::fake();

        $this->pullEarnings($token, '')->assertStatus(422);
        $this->pullEarnings($token, 'from=06.10.2026&to=12.10.2026')->assertStatus(422);
        $this->pullEarnings($token, 'from=2026-10-12&to=2026-10-06')->assertStatus(422);
        $this->pullEarnings($token, 'from=2026-01-01&to=2026-12-31')->assertStatus(422)->assertJsonPath('reason', 'range_exceeds_'.$this->maxEarningsDays().'_days');
        Http::assertNothingSent();
    }

    private function maxEarningsDays(): int
    {
        return (new \ReflectionClassConstant(ElProfessorController::class, 'MAX_EARNINGS_DAYS'))->getValue();
    }

    private function rangeOf(int $days): string
    {
        $from = CarbonImmutable::parse('2026-09-01');

        return 'from='.$from->toDateString().'&to='.$from->addDays($days - 1)->toDateString();
    }

    public function test_a_range_of_exactly_the_cap_is_accepted_and_one_day_more_is_refused(): void
    {
        $token = $this->mint();
        $this->uberSession($this->tenant);
        $this->withProxy($this->tenant);
        Http::fake(['*/graphql' => Http::response($this->hubPage([], null))]);
        $max = $this->maxEarningsDays();

        $this->pullEarnings($token, $this->rangeOf($max))->assertOk();
        $this->pullEarnings($token, $this->rangeOf($max + 1))->assertStatus(422)
            ->assertJsonPath('reason', "range_exceeds_{$max}_days")
            ->assertJsonPath('max_days', $max);
    }

    public function test_a_five_week_business_month_is_not_refused(): void
    {
        // A business month owns the weeks whose Monday falls in it. June 2026
        // has five Mondays (1, 8, 15, 22, 29), so its business month is five
        // whole Uber weeks: 35 days, from Monday 1 June to Sunday 5 July.
        $from = CarbonImmutable::parse('2026-06-01');
        $this->assertTrue($from->isMonday());
        $to = $from->addWeeks(5)->subDay();
        $this->assertSame(35, (int) $from->diffInDays($to) + 1);

        $token = $this->mint();
        $this->uberSession($this->tenant);
        $this->withProxy($this->tenant);
        Http::fake(['*/graphql' => Http::response($this->hubPage([], null))]);

        $this->pullEarnings($token, 'from='.$from->toDateString().'&to='.$to->toDateString())->assertOk();
    }

    public function test_the_range_is_sent_as_uber_operating_days_starting_at_four(): void
    {
        $token = $this->mint();
        $this->uberSession($this->tenant);
        $this->withProxy($this->tenant);
        Http::fake(['*/graphql' => Http::response($this->hubPage([], null))]);

        $this->pullEarnings($token, 'from=2026-10-06&to=2026-10-12')->assertOk();

        $start = CarbonImmutable::parse('2026-10-06 04:00', 'Europe/Berlin')->getTimestampMs();
        $end = CarbonImmutable::parse('2026-10-13 04:00', 'Europe/Berlin')->getTimestampMs();
        // STRINGS, and the empty string for the first page: this test pinned
        // ints and a null token until 13.10.2026, so it passed against a fake
        // while Uber answered 400 -- a fake validates nothing about a schema.
        Http::assertSent(fn ($r) => $r['variables']['timeRange']['startTimeUnixMillis'] === (string) $start
            && $r['variables']['timeRange']['endTimeUnixMillis'] === (string) $end
            && $r['variables']['timeRange']['unixMilliOrDate'] === 'Unix_Time_Range'
            && $r['variables']['pageOptions']['pageSize'] === 10
            && $r['variables']['pageOptions']['pageToken'] === '');
    }

    public function test_the_window_is_uber_s_week_monday_four_to_monday_four_not_midnights(): void
    {
        // Uber's own weeks run 04:00 -> 04:00 Europe/Berlin. The owner compares
        // our totals with the figures on Uber's screen, so midnights make them
        // differ for any ride starting between 00:00 and 04:00 on the boundary
        // day. If this fails after a "simplification" to startOfDay(), that is why.
        $token = $this->mint();
        $this->uberSession($this->tenant);
        $this->withProxy($this->tenant);
        Http::fake(['*/graphql' => Http::response($this->hubPage([], null))]);

        $this->pullEarnings($token, 'from=2026-10-05&to=2026-10-11')->assertOk();

        $from = CarbonImmutable::parse('2026-10-05', 'Europe/Berlin')->setTime(4, 0);
        $after = CarbonImmutable::parse('2026-10-11', 'Europe/Berlin')->addDay()->setTime(4, 0);
        Http::assertSent(function ($r) use ($from, $after) {
            $range = $r['variables']['timeRange'];
            $start = CarbonImmutable::createFromTimestampMs((int) $range['startTimeUnixMillis'], 'Europe/Berlin');
            $end = CarbonImmutable::createFromTimestampMs((int) $range['endTimeUnixMillis'], 'Europe/Berlin');

            $this->assertSame($from->format('Y-m-d H:i'), $start->format('Y-m-d H:i'), 'the window must start at 04:00 Berlin on the from day, not at midnight');
            $this->assertSame($after->format('Y-m-d H:i'), $end->format('Y-m-d H:i'), 'the window must end at 04:00 Berlin on the day after the to day, not at midnight');
            $this->assertSame(7 * 24 * 3600, $end->getTimestamp() - $start->getTimestamp(), 'one Uber week is exactly 7 x 24 hours');

            return true;
        });
    }

    public function test_the_millis_are_strings_because_they_overflow_a_graphql_int(): void
    {
        // The reason, stated as an assertion rather than as a comment: both
        // stamps are larger than PHP_INT_MAX would suggest is safe to send as
        // a GraphQL Int, whose range is a signed 32-bit number. If someone
        // "simplifies" the casts away, this is what says why they were there.
        $token = $this->mint();
        $this->uberSession($this->tenant);
        $this->withProxy($this->tenant);
        Http::fake(['*/graphql' => Http::response($this->hubPage([], null))]);

        $this->pullEarnings($token, 'from=2026-10-06&to=2026-10-12')->assertOk();

        Http::assertSent(function ($r) {
            $range = $r['variables']['timeRange'];
            foreach (['startTimeUnixMillis', 'endTimeUnixMillis'] as $key) {
                $this->assertIsString($range[$key], $key.' must be a string');
                $this->assertGreaterThan(2147483647, (int) $range[$key], $key.' overflows a GraphQL Int');
            }

            return true;
        });
    }

    public function test_the_earnings_route_needs_a_token_and_a_closed_company_is_refused(): void
    {
        $this->getJson('/api/v1/elprofessor/earnings?from=2026-10-06&to=2026-10-12')->assertStatus(401);

        $token = $this->mint();
        $this->tenant->setElprofessorEnabled(false);
        $this->app['auth']->forgetGuards();
        // The switch deletes the tokens, so the closed company's token is gone: 401.
        $this->pullEarnings($token)->assertStatus(401);
    }

    public function test_the_earnings_route_widens_nothing_it_is_exactly_one_get(): void
    {
        $token = $this->mint();
        Http::fake();

        // Reachable: the confinement lets the pattern through (a 422 is the
        // route itself answering, not the middleware refusing).
        $this->pullEarnings($token, '')->assertStatus(422);

        // Not reachable: neighbours of the new path, and the write verbs.
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/elprofessor/earnings/anything')->assertStatus(404);
        $this->withHeaders($this->bearer($token))->postJson('/api/v1/elprofessor/earnings')->assertStatus(405);
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/elprofessor')->assertStatus(404);
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/fleet-session')->assertStatus(403);
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/dispatch/offers')->assertStatus(403);
    }

    //
    //  Notes: the ten types, and the vehicle the five incident types must name.
    //  El-Professor refuses an incident without a plate (`vehicle_required`);
    //  these prove the refusal happens here first.

    private function connectedDriver(): Driver
    {
        Storage::fake('local');
        Queue::fake();
        $token = $this->mint();
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/elprofessor/fleet')->assertOk();
        $driver = $this->driver($this->tenant, 'Omar');
        $this->actingAsDriver($driver);

        return $driver;
    }

    private function note(array $extra): TestResponse
    {
        return $this->postJson('/api/v1/driver/submissions', $extra + [
            'subject' => 'note', 'note_text' => 'Text',
        ]);
    }

    public function test_an_incident_note_without_a_plate_is_refused_here_and_never_stored(): void
    {
        $this->connectedDriver();

        foreach (['blitzer', 'accident', 'kontrolle', 'breakdown', 'wait'] as $type) {
            $this->note(['note_type' => $type])->assertStatus(422)->assertJsonValidationErrors('vehicle_plate');
            $this->note(['note_type' => $type, 'vehicle_plate' => '  '])->assertStatus(422)->assertJsonValidationErrors('vehicle_plate');
            $this->note(['note_type' => $type, 'vehicle_plate' => 'null'])->assertStatus(422)->assertJsonValidationErrors('vehicle_plate');
        }

        $this->assertSame(0, ElProfessorSubmission::withoutGlobalScopes()->count());
        Queue::assertNotPushed(RingElProfessor::class);
    }

    public function test_an_incident_note_with_a_plate_travels_with_it_verbatim(): void
    {
        $this->connectedDriver();

        $this->note(['note_type' => 'blitzer', 'vehicle_plate' => 'B-XX 1234'])->assertStatus(201);

        $row = ElProfessorSubmission::withoutGlobalScopes()->firstOrFail();
        $this->assertSame('B-XX 1234', $row->payload['vehicle_plate']);
    }

    public function test_a_plate_over_32_characters_is_refused(): void
    {
        $this->connectedDriver();

        $this->note(['note_type' => 'blitzer', 'vehicle_plate' => str_repeat('A', 33)])->assertStatus(422);
        $this->note(['note_type' => 'blitzer', 'vehicle_plate' => str_repeat('A', 32)])->assertStatus(201);
    }

    public function test_the_other_five_types_need_no_plate_and_send_none(): void
    {
        $this->connectedDriver();

        foreach (['general', 'other', 'sick', 'vacation', 'off'] as $type) {
            $this->note(['note_type' => $type])->assertStatus(201);
            $this->note(['note_type' => $type, 'vehicle_plate' => ''])->assertStatus(201);
        }

        foreach (ElProfessorSubmission::withoutGlobalScopes()->get() as $row) {
            $this->assertArrayNotHasKey('vehicle_plate', $row->payload);
        }
    }

    public function test_the_absence_types_cross_and_an_unknown_type_does_not(): void
    {
        $this->connectedDriver();

        $this->note(['note_type' => 'sick'])->assertStatus(201);
        $this->note(['note_type' => 'vacation'])->assertStatus(201);
        $this->note(['note_type' => 'off'])->assertStatus(201);
        foreach (['krank', 'krankheit', 'Sick', 'blitzr'] as $type) {
            $this->note(['note_type' => $type])->assertStatus(422)->assertJsonValidationErrors('note_type');
        }
    }

    public function test_the_vehicle_list_is_this_fleets_plates_only_and_reduced(): void
    {
        $mine = Vehicle::create(['tenant_id' => $this->tenant->id, 'uber_vehicle_uuid' => 'u1', 'license_plate' => 'B-AA 1', 'make' => 'VW', 'model' => 'Touran', 'vin' => 'SECRETVIN']);
        Vehicle::create(['tenant_id' => $this->tenant->id, 'uber_vehicle_uuid' => 'u2', 'license_plate' => null]);
        Vehicle::withoutGlobalScopes()->create(['tenant_id' => $this->other->id, 'uber_vehicle_uuid' => 'u3', 'license_plate' => 'M-ZZ 9']);
        $this->connectedDriver();

        $response = $this->getJson('/api/v1/driver/vehicles')->assertOk();

        $response->assertJsonCount(1, 'data');
        $response->assertJsonPath('data.0.license_plate', 'B-AA 1');
        $this->assertSame(['id', 'license_plate', 'make', 'model'], array_keys($response->json('data.0')));
        $this->assertSame($mine->id, $response->json('data.0.id'));
    }

    public function test_the_vehicle_list_is_refused_to_an_unconnected_company_and_to_a_dashboard_token(): void
    {
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));
        $this->getJson('/api/v1/driver/vehicles')->assertStatus(403)->assertJsonPath('reason', 'not_connected');

        // The fleet-owner and El-Professor tokens are confined and are not drivers.
        $token = $this->mint();
        $this->assertContains($this->withHeaders($this->bearer($token))->getJson('/api/v1/driver/vehicles')->status(), [401, 403]);
    }

    // -- The vehicle list for El-Professor's onboarding import -----------------

    private function pullVehicles(string $token, string $query = ''): TestResponse
    {
        return $this->getJson('/api/v1/elprofessor/vehicles'.($query === '' ? '' : '?'.$query), $this->bearer($token));
    }

    public function test_the_vehicle_pull_is_this_tenants_and_not_another(): void
    {
        $mine = Vehicle::create(['tenant_id' => $this->tenant->id, 'uber_vehicle_uuid' => 'mine-1', 'license_plate' => 'B-AA 1']);
        Vehicle::create(['tenant_id' => $this->tenant->id, 'uber_vehicle_uuid' => 'mine-2', 'license_plate' => null]);
        Vehicle::withoutGlobalScopes()->create(['tenant_id' => $this->other->id, 'uber_vehicle_uuid' => 'theirs-1', 'license_plate' => 'M-ZZ 9']);
        $token = $this->mint();

        $response = $this->pullVehicles($token)
            ->assertOk()
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('meta.tenant_id', $this->tenant->id)
            ->assertJsonPath('data.0.id', $mine->id)
            ->assertJsonPath('data.1.license_plate', null);

        $this->assertStringNotContainsString('theirs-1', $response->getContent());
        $this->assertStringNotContainsString('M-ZZ 9', $response->getContent());
    }

    public function test_the_vehicle_pull_pages_and_caps_like_the_roster(): void
    {
        foreach (range(1, 3) as $i) {
            Vehicle::create(['tenant_id' => $this->tenant->id, 'uber_vehicle_uuid' => 'v'.$i]);
        }
        $token = $this->mint();

        $this->pullVehicles($token, 'per_page=500')
            ->assertOk()
            ->assertJsonPath('meta.per_page', 100)
            ->assertJsonPath('meta.page', 1);

        $this->pullVehicles($token, 'per_page=2&page=2')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.per_page', 2)
            ->assertJsonPath('meta.page', 2)
            ->assertJsonPath('meta.total', 3);
    }

    public function test_a_token_without_the_el_professor_ability_cannot_pull_vehicles(): void
    {
        $this->openIntegration();
        Vehicle::create(['tenant_id' => $this->tenant->id, 'uber_vehicle_uuid' => 'v1']);

        // No credential at all.
        $this->getJson('/api/v1/elprofessor/vehicles')->assertUnauthorized();

        // A real token holding only the extension's ability is confined by that
        // ability's own list, which does not name this route.
        $other = $this->manager->createToken('ext', ['fleet-session:write'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/elprofessor/vehicles', $this->bearer($other))->assertForbidden();
    }

    public function test_the_vehicle_pull_is_refused_when_the_integration_is_disabled(): void
    {
        $token = $this->mint();
        // Disabled WITHOUT deleting the token (setElprofessorEnabled(false) would
        // make it a 401): the middleware is the wall under test.
        $this->tenant->fresh()->mergeElprofessorState(['enabled' => false]);

        $this->pullVehicles($token)
            ->assertStatus(403)
            ->assertJsonPath('reason', 'integration_disabled');
    }

    public function test_the_vehicle_pull_carries_exactly_the_listed_fields(): void
    {
        Vehicle::create([
            'tenant_id' => $this->tenant->id, 'uber_vehicle_uuid' => 'u1', 'license_plate' => 'B-AA 1',
            'make' => 'VW', 'model' => 'Touran', 'year' => 2022, 'vin' => 'WVW123',
            'color' => 'Black', 'color_hex' => '#000000', 'image_url' => 'https://img/car.png',
            'compliance_status' => 'ok', 'assigned_driver_uuid' => 'drv-1', 'synced_at' => now(),
        ]);
        $token = $this->mint();

        $response = $this->pullVehicles($token)->assertOk();

        $keys = array_keys($response->json('data.0'));
        sort($keys);
        $this->assertSame(
            ['assigned_driver_uuid', 'id', 'license_plate', 'uber_vehicle_uuid'],
            $keys,
        );
        $this->assertStringNotContainsString('vin', $response->getContent());
        $this->assertStringNotContainsString('image_url', $response->getContent());
        $this->assertStringNotContainsString('color_hex', $response->getContent());
        $this->assertStringNotContainsString('img/car.png', $response->getContent());
    }

    public function test_the_vehicle_route_widens_nothing_it_is_exactly_one_get(): void
    {
        $token = $this->mint();

        $this->pullVehicles($token)->assertOk();

        $this->withHeaders($this->bearer($token))->postJson('/api/v1/elprofessor/vehicles')->assertStatus(405);
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/elprofessor/vehicles/1')->assertStatus(404);
        // The dashboard's own vehicle list stays out of reach.
        $this->withHeaders($this->bearer($token))->getJson('/api/v1/vehicles')->assertStatus(403);
        $this->withHeaders($this->bearer($token))->postJson('/api/v1/vehicles')->assertStatus(403);
    }

    public function test_the_driver_profile_requires_the_odometer_by_default(): void
    {
        // Absent means required: existing companies keep today's flow.
        $this->connectCompany();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $this->getJson('/api/v1/driver/me')
            ->assertOk()
            ->assertJsonPath('data.odometer_required', true);
    }

    public function test_the_settings_patch_flips_the_odometer_and_leaves_the_gallery_alone_and_back(): void
    {
        $this->openIntegration();
        Sanctum::actingAs($this->manager, ['*']);

        $this->patchJson('/api/v1/elprofessor/settings', ['gallery_import' => true])
            ->assertOk()->assertJsonPath('data.gallery_import', true)
            ->assertJsonPath('data.odometer_required', true);

        $this->patchJson('/api/v1/elprofessor/settings', ['odometer_required' => false])
            ->assertOk()->assertJsonPath('data.odometer_required', false)
            ->assertJsonPath('data.gallery_import', true);

        $this->patchJson('/api/v1/elprofessor/settings', ['gallery_import' => false])
            ->assertOk()->assertJsonPath('data.gallery_import', false)
            ->assertJsonPath('data.odometer_required', false);

        $this->assertFalse($this->tenant->fresh()->elprofessorOdometerRequired());
    }

    public function test_a_company_that_switched_the_odometer_off_tells_its_drivers_so(): void
    {
        $this->connectCompany();
        $tenant = $this->tenant->fresh();
        $tenant->setElprofessorOdometerRequired(false);
        $tenant->save();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $this->getJson('/api/v1/driver/me')
            ->assertOk()
            ->assertJsonPath('data.odometer_required', false);
    }

    public function test_a_refuel_without_an_odometer_is_accepted(): void
    {
        Storage::fake('local');
        Queue::fake();
        $this->connectCompany();
        $this->actingAsDriver($this->driver($this->tenant, 'Omar'));

        $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'receipt',
            'receipt_date' => '2026-10-07',
            'amount' => '41.47',
            'category' => 'Tanken',
            'payment_method' => 'bar',
            'merchant_name' => 'ARAL Tankstelle',
            'city' => 'Berlin',
            'receipt_time' => '14:32',
            'litres' => '41.47',
            'price_per_litre' => '1.789',
            'odometer_km' => null,
            'range_km' => null,
        ])->assertStatus(201);
    }
}
