<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberPasskey;
use App\Domain\Dispatch\PasskeyService;
use App\Domain\Dispatch\UberAuthClient;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class UberPasskeyReloginTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.dispatch.ingest_secret' => self::SECRET,
            'services.uber_auth.url' => 'http://uber-auth.test',
            'services.uber_auth.secret' => 's',
            'services.passkey.enabled' => true,
            'services.passkey.tenants' => [],
            'services.passkey.relogin' => true,
        ]);
        Cache::flush();
    }

    private function tenant(array $passkey = ['enabled' => true, 'relogin' => true]): Tenant
    {
        return Tenant::create(['name' => 'YA', 'country' => 'DE', 'status' => 'active', 'activated_at' => now(), 'settings' => ['passkey' => $passkey]]);
    }

    private function register(Tenant $tenant): void
    {
        app(PasskeyService::class)->store($tenant, [
            'credentialId' => 'cid', 'privateKey' => 'SECRET-KEY', 'rpId' => 'uber.com',
            'userHandle' => 'uh', 'signCount' => 3, 'isResidentCredential' => true,
        ]);
    }

    private function startBody(Tenant $tenant): array
    {
        Http::fake(['*/login/start' => Http::response(['status' => 'mfa_required'])]);
        app(UberAuthClient::class)->startLogin($tenant, 'a@b.de');

        return Http::recorded()[0][0]->data();
    }

    public function test_start_login_offers_passkey_only_when_every_gate_and_an_active_key_hold(): void
    {
        $tenant = $this->tenant();
        $this->assertArrayNotHasKey('passkey', $this->startBody($tenant)); // no registered key
        $this->register($tenant);
        $body = $this->startBody($tenant);
        $this->assertTrue($body['passkey']);
        $this->assertStringNotContainsString('SECRET-KEY', json_encode($body));
        $this->assertStringNotContainsString('cid', json_encode($body));
    }

    public function test_each_gate_off_means_no_passkey_flag(): void
    {
        $tenant = $this->tenant();
        $this->register($tenant);
        config(['services.passkey.relogin' => false]);
        $this->assertArrayNotHasKey('passkey', $this->startBody($tenant));
        config(['services.passkey.relogin' => true]);
        $tenant->update(['settings' => ['passkey' => ['enabled' => true]]]);
        $this->assertArrayNotHasKey('passkey', $this->startBody($tenant->fresh()));
    }

    public function test_breaker_opens_after_two_consecutive_failures_and_a_success_resets_it(): void
    {
        $tenant = $this->tenant();
        $this->register($tenant);
        $svc = app(PasskeyService::class);
        $svc->recordLoginResult($tenant->id, false);
        $this->assertTrue($svc->shouldOfferForRelogin($tenant));
        $svc->recordLoginResult($tenant->id, false);
        $this->assertFalse($svc->shouldOfferForRelogin($tenant));
        $this->assertArrayNotHasKey('passkey', $this->startBody($tenant));
        $svc->recordLoginResult($tenant->id, true);
        $this->assertTrue($svc->shouldOfferForRelogin($tenant));
    }

    public function test_used_endpoint_persists_sign_count_and_marks_used(): void
    {
        $tenant = $this->tenant();
        $this->register($tenant);
        $this->withHeader('X-Dispatch-Secret', self::SECRET)
            ->postJson("/api/v1/internal/session-browser/{$tenant->id}/passkey/used", ['signCount' => 9])
            ->assertOk();
        $row = UberPasskey::withoutGlobalScopes()->where('tenant_id', $tenant->id)->first();
        $this->assertSame(9, $row->credential['signCount']);
        $this->assertSame('SECRET-KEY', $row->credential['privateKey']);
        $this->assertSame(1, $row->use_count);
        $this->assertNotNull($row->last_used_at);
    }

    public function test_used_and_login_failed_validate_and_need_the_secret(): void
    {
        $tenant = $this->tenant();
        $url = "/api/v1/internal/session-browser/{$tenant->id}/passkey/used";
        $this->postJson($url, ['signCount' => 1])->assertStatus(401);
        $this->withHeader('X-Dispatch-Secret', self::SECRET)->postJson($url, [])->assertStatus(422);
    }

    public function test_credential_endpoint_still_404s_when_disabled(): void
    {
        $tenant = $this->tenant();
        $this->register($tenant);
        config(['services.passkey.enabled' => false]);
        $this->withHeader('X-Dispatch-Secret', self::SECRET)
            ->getJson("/api/v1/internal/session-browser/{$tenant->id}/passkey/credential")->assertNotFound();
    }
}
