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

        Sanctum::actingAs($driver, guard: 'driver');
        $this->getJson('/api/v1/driver/me')->assertOk()->assertJsonPath('data.documents_enabled', false);

        $this->getJson('/api/v1/elprofessor/fleet/drivers', $this->bearer($token))->assertOk();

        $state = $this->tenant->fresh()->settings['elprofessor'];
        $this->assertNotNull($state['first_used_at']);
        $this->assertNotNull($state['last_used_at']);

        Sanctum::actingAs($this->manager, ['*']);
        $this->getJson('/api/v1/elprofessor/connection')->assertOk()->assertJsonPath('data.connected', true);

        Sanctum::actingAs($driver, guard: 'driver');
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

        Sanctum::actingAs($driver, guard: 'driver');
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
}
