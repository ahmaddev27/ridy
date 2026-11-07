<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SessionHygieneFlagTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.dispatch.ingest_secret' => self::SECRET]);
    }

    private function tenant(array $settings = []): Tenant
    {
        return Tenant::create([
            'name' => 'YA', 'country' => 'DE', 'status' => 'active', 'activated_at' => now(),
            'settings' => $settings,
        ]);
    }

    private function hygiene(Tenant|int $tenant, bool $auth = true)
    {
        $id = $tenant instanceof Tenant ? $tenant->id : $tenant;
        $client = $auth ? $this->withHeader('X-Dispatch-Secret', self::SECRET) : $this;

        return $client->getJson("/api/v1/internal/session-browser/{$id}/device-hygiene");
    }

    public function test_defaults_to_disabled(): void
    {
        $this->hygiene($this->tenant())->assertOk()->assertExactJson(['data' => ['enabled' => false]]);
    }

    public function test_enabled_when_flag_set(): void
    {
        $this->hygiene($this->tenant(['session_hygiene' => ['enabled' => true]]))
            ->assertOk()->assertExactJson(['data' => ['enabled' => true]]);
    }

    public function test_requires_the_dispatch_secret_and_a_real_tenant(): void
    {
        $tenant = $this->tenant();
        $this->hygiene($tenant, false)->assertStatus(401);
        $this->hygiene(999999)->assertNotFound();
    }

    public function test_setter_flips_flag_and_keeps_other_settings(): void
    {
        $tenant = $this->tenant(['passkey' => ['enabled' => false]]);
        $tenant->setSessionHygiene(true);
        $this->assertTrue($tenant->fresh()->sessionHygieneEnabled());
        $this->assertFalse($tenant->fresh()->settings['passkey']['enabled']);
        $tenant->setSessionHygiene(false);
        $this->assertFalse($tenant->fresh()->sessionHygieneEnabled());
    }

    public function test_command_toggles_flag(): void
    {
        $tenant = $this->tenant();
        $this->artisan('session-hygiene:set', ['tenant' => $tenant->id, 'state' => 'on'])->assertSuccessful();
        $this->assertTrue($tenant->fresh()->sessionHygieneEnabled());
        $this->artisan('session-hygiene:set', ['tenant' => $tenant->id, 'state' => 'off'])->assertSuccessful();
        $this->assertFalse($tenant->fresh()->sessionHygieneEnabled());
        $this->artisan('session-hygiene:set', ['tenant' => $tenant->id, 'state' => 'maybe'])->assertFailed();
        $this->artisan('session-hygiene:set', ['tenant' => 999999, 'state' => 'on'])->assertFailed();
    }
}
