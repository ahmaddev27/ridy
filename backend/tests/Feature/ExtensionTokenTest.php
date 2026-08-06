<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ExtensionTokenTest extends TestCase
{
    use RefreshDatabase;

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    private Tenant $tenant;

    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        app(TenantContext::class)->set($this->tenant->id);
        $this->manager = User::create([
            'name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id,
        ]);
    }

    public function test_manager_issues_an_extension_token(): void
    {
        Sanctum::actingAs($this->manager);

        $this->postJson('/api/v1/extension/token')
            ->assertOk()
            ->assertJsonStructure(['data' => ['token']]);

        $this->assertSame(1, $this->manager->tokens()->where('name', 'ridy-extension')->count());
    }

    public function test_issuing_a_token_replaces_the_previous_one(): void
    {
        Sanctum::actingAs($this->manager);

        $this->postJson('/api/v1/extension/token');
        $this->postJson('/api/v1/extension/token');

        $this->assertSame(1, $this->manager->tokens()->where('name', 'ridy-extension')->count());
    }

    public function test_extension_captures_session_with_the_token(): void
    {
        // Mint a real token (not Sanctum::actingAs) so we exercise Bearer auth.
        $token = $this->manager->createToken('ridy-extension')->plainTextToken;

        $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson('/api/v1/fleet-session', [
                'uber_org_uuid' => self::ORG,
                'cookies' => [['name' => 'sid', 'value' => 'abc']],
            ])
            ->assertCreated()
            ->assertJsonPath('data.uber_org_uuid', self::ORG);

        $this->assertSame(self::ORG, $this->tenant->fresh()->uber_org_uuid);
        $this->assertSame(1, UberFleetSession::withoutGlobalScopes()->count());
    }

    public function test_capture_rejects_a_missing_token(): void
    {
        $this->postJson('/api/v1/fleet-session', [
            'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'abc']],
        ])->assertUnauthorized();
    }
}
