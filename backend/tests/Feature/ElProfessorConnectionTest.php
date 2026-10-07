<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
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
}
