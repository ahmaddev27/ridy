<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberPasskey;
use App\Domain\Dispatch\PasskeySettings;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class UberPasskeyTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.dispatch.ingest_secret' => self::SECRET]);
    }

    private function tenant(bool $perTenant = true): Tenant
    {
        return Tenant::create([
            'name' => 'YA', 'country' => 'DE', 'status' => 'active', 'activated_at' => now(),
            'settings' => $perTenant ? ['passkey' => ['enabled' => true]] : [],
        ]);
    }

    private function enable(): void
    {
        config(['services.passkey.enabled' => true, 'services.passkey.tenants' => []]);
    }

    private function credential(string $key = 'PRIVATE-KEY-MATERIAL'): array
    {
        return ['credentialId' => 'cred-abc', 'privateKey' => $key, 'rpId' => 'uber.com', 'userHandle' => 'uh', 'signCount' => 0, 'isResidentCredential' => true];
    }

    private function sendCredential(Tenant $tenant, array $credential)
    {
        return $this->withHeader('X-Dispatch-Secret', self::SECRET)
            ->postJson("/api/v1/internal/session-browser/{$tenant->id}/passkey", ['credential' => $credential]);
    }

    public function test_credential_is_encrypted_at_rest_and_round_trips(): void
    {
        $this->enable();
        $tenant = $this->tenant();

        $this->sendCredential($tenant, $this->credential())->assertOk()->assertJsonPath('data.created', true);

        $raw = DB::table('uber_passkeys')->where('tenant_id', $tenant->id)->first();
        $this->assertStringNotContainsString('PRIVATE-KEY-MATERIAL', $raw->credential);
        $this->assertSame(hash('sha256', 'cred-abc'), $raw->credential_id_hash);
        $this->assertSame('PRIVATE-KEY-MATERIAL', UberPasskey::withoutGlobalScopes()->first()->credential['privateKey']);
    }

    public function test_second_post_does_not_overwrite_an_active_passkey(): void
    {
        $this->enable();
        $tenant = $this->tenant();
        $this->sendCredential($tenant, $this->credential('FIRST'))->assertOk();

        $this->sendCredential($tenant, $this->credential('SECOND'))->assertOk()->assertJsonPath('data.created', false);

        $this->assertSame(1, UberPasskey::withoutGlobalScopes()->count());
        $this->assertSame('FIRST', UberPasskey::withoutGlobalScopes()->first()->credential['privateKey']);
    }

    public function test_model_never_serializes_the_credential(): void
    {
        $this->enable();
        $tenant = $this->tenant();
        $this->sendCredential($tenant, $this->credential());

        $passkey = UberPasskey::withoutGlobalScopes()->first();

        $this->assertArrayNotHasKey('credential', $passkey->toArray());
        $this->assertStringNotContainsString('PRIVATE-KEY-MATERIAL', $passkey->toJson());
    }

    public function test_get_reports_flags_and_never_the_credential(): void
    {
        $this->enable();
        $tenant = $this->tenant();
        $url = "/api/v1/internal/session-browser/{$tenant->id}/passkey";

        $this->withHeader('X-Dispatch-Secret', self::SECRET)->getJson($url)
            ->assertOk()->assertExactJson(['data' => ['enabled' => true, 'registered' => false]]);

        $this->sendCredential($tenant, $this->credential());

        $res = $this->withHeader('X-Dispatch-Secret', self::SECRET)->getJson($url)->assertOk();
        $this->assertTrue($res->json('data.registered'));
        $this->assertStringNotContainsString('PRIVATE-KEY-MATERIAL', $res->getContent());
    }

    public function test_post_is_refused_when_not_enabled_and_needs_the_secret(): void
    {
        $tenant = $this->tenant();
        $this->sendCredential($tenant, $this->credential())->assertForbidden();
        $this->assertSame(0, UberPasskey::withoutGlobalScopes()->count());

        $this->postJson("/api/v1/internal/session-browser/{$tenant->id}/passkey", [])->assertForbidden();
    }

    public function test_post_validates_the_credential_shape(): void
    {
        $this->enable();
        $tenant = $this->tenant();

        $this->sendCredential($tenant, ['credentialId' => 'x'])->assertUnprocessable();
    }

    public function test_flag_matrix(): void
    {
        $settings = new PasskeySettings;
        $tenant = $this->tenant();
        $off = $this->tenant(false);

        $this->assertFalse($settings->availableFor($tenant), 'global off');

        config(['services.passkey.enabled' => true, 'services.passkey.tenants' => []]);
        $this->assertTrue($settings->availableFor($tenant));
        $this->assertFalse($settings->availableFor($off), 'per-tenant off');
        $this->assertFalse($settings->availableFor(null));

        config(['services.passkey.tenants' => ['999999']]);
        $this->assertFalse($settings->availableFor($tenant), 'not allowlisted');

        config(['services.passkey.tenants' => [(string) $tenant->id]]);
        $this->assertTrue($settings->availableFor($tenant));

        $this->assertFalse($settings->loginEnabledFor($tenant), 'login flag off');
        config(['services.passkey.login' => true]);
        $this->assertTrue($settings->loginEnabledFor($tenant));
    }
}
