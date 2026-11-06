<?php

namespace Tests\Feature;

use App\Domain\Dispatch\AutoReloginService;
use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Dispatch\Models\UberPasskey;
use App\Domain\Dispatch\PasskeyService;
use App\Domain\Dispatch\PasskeySettings;
use App\Domain\Dispatch\UberAuthClient;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
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

    private function register(Tenant $tenant, ?string $account = null): void
    {
        app(PasskeyService::class)->store($tenant, [
            'credentialId' => 'cid', 'privateKey' => 'SECRET-KEY', 'rpId' => 'uber.com',
            'userHandle' => 'uh', 'signCount' => 3, 'isResidentCredential' => true,
        ] + ($account !== null ? ['account' => $account] : []));
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

    public function test_a_tenant_with_no_passkey_settings_is_register_and_relogin_enabled_by_default(): void
    {
        $settings = new PasskeySettings;
        $tenant = Tenant::create(['name' => 'N', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
        $this->assertTrue($settings->availableFor($tenant));
        $this->assertTrue($settings->reloginAvailableFor($tenant));

        $tenant->update(['settings' => ['passkey' => ['relogin' => false]]]);
        $this->assertTrue($settings->availableFor($tenant->fresh()));
        $this->assertFalse($settings->reloginAvailableFor($tenant->fresh()));

        $tenant->update(['settings' => ['passkey' => ['enabled' => false]]]);
        $this->assertFalse($settings->availableFor($tenant->fresh()));
        $this->assertFalse($settings->reloginAvailableFor($tenant->fresh()));

        config(['services.passkey.enabled' => false]);
        $tenant->update(['settings' => []]);
        $this->assertFalse($settings->availableFor($tenant->fresh()), 'global master off');
    }

    public function test_each_gate_off_means_no_passkey_flag(): void
    {
        $tenant = $this->tenant();
        $this->register($tenant);
        config(['services.passkey.relogin' => false]);
        $this->assertArrayNotHasKey('passkey', $this->startBody($tenant));
        config(['services.passkey.relogin' => true]);
        $tenant->update(['settings' => ['passkey' => ['enabled' => true, 'relogin' => false]]]);
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
        $this->withHeader('X-Dispatch-Secret', self::SECRET)->postJson($url, ['signCount' => 'x'])->assertStatus(422);
    }

    public function test_used_without_sign_count_still_resets_the_breaker_and_marks_used(): void
    {
        $tenant = $this->tenant();
        $this->register($tenant);
        $svc = app(PasskeyService::class);
        $svc->recordLoginResult($tenant->id, false);
        $this->withHeader('X-Dispatch-Secret', self::SECRET)
            ->postJson("/api/v1/internal/session-browser/{$tenant->id}/passkey/used", [])->assertOk();
        $row = UberPasskey::withoutGlobalScopes()->where('tenant_id', $tenant->id)->first();
        $this->assertSame(3, $row->credential['signCount']);
        $this->assertSame(1, $row->use_count);
        $svc->recordLoginResult($tenant->id, false);
        $this->assertTrue($svc->shouldOfferForRelogin($tenant)); // counter was reset by the success
    }

    public function test_used_and_login_failed_404_when_the_passkey_gate_is_off(): void
    {
        $tenant = $this->tenant();
        $this->register($tenant);
        config(['services.passkey.enabled' => false]);
        $base = "/api/v1/internal/session-browser/{$tenant->id}/passkey";
        $this->withHeader('X-Dispatch-Secret', self::SECRET)->postJson("$base/used", ['signCount' => 5])->assertNotFound();
        $this->withHeader('X-Dispatch-Secret', self::SECRET)->postJson("$base/login-failed", [])->assertNotFound();
    }

    public function test_the_credential_is_encrypted_at_rest(): void
    {
        $tenant = $this->tenant();
        $this->register($tenant);
        app(PasskeyService::class)->recordSignIn($tenant->id, 11);
        $raw = \DB::table('uber_passkeys')->where('tenant_id', $tenant->id)->value('credential');
        $this->assertStringNotContainsString('SECRET-KEY', (string) $raw);
    }

    public function test_credential_endpoint_still_404s_when_disabled(): void
    {
        $tenant = $this->tenant();
        $this->register($tenant);
        config(['services.passkey.enabled' => false]);
        $this->withHeader('X-Dispatch-Secret', self::SECRET)
            ->getJson("/api/v1/internal/session-browser/{$tenant->id}/passkey/credential")->assertNotFound();
    }

    private function needsOtp(Tenant $tenant): void
    {
        SessionBrowser::create(['tenant_id' => $tenant->id, 'state' => SessionBrowser::STATE_NEEDS_OTP]);
    }

    public function test_passkey_ready_tenant_without_email_or_opt_in_triggers_and_starts_usernameless(): void
    {
        Queue::fake();
        $tenant = $this->tenant();
        $this->register($tenant);
        $this->needsOtp($tenant);
        $auto = app(AutoReloginService::class);

        $this->assertTrue($auto->onNeedsOtp($tenant->id));
        Http::fake(['*/login/start' => Http::response(['status' => 'mfa_required', 'login_id' => 'L1', 'channel' => 'email'])]);
        $auto->run($tenant->id);

        $body = Http::recorded()[0][0]->data();
        $this->assertTrue($body['passkey']);
        $this->assertSame('', $body['email']);
        $this->assertStringNotContainsString('SECRET-KEY', json_encode($body));
    }

    public function test_passkey_ready_tenant_without_configured_email_starts_with_the_stored_account_email(): void
    {
        Queue::fake();
        Log::spy();
        $tenant = $this->tenant();
        $this->register($tenant, 'owner@fleet.de');
        $this->needsOtp($tenant);
        $auto = app(AutoReloginService::class);

        $this->assertTrue($auto->onNeedsOtp($tenant->id));
        Http::fake(['*/login/start' => Http::response(['status' => 'success'])]);
        $auto->run($tenant->id);

        $body = Http::recorded()[0][0]->data();
        $this->assertTrue($body['passkey']);
        $this->assertSame('owner@fleet.de', $body['email']);
        $this->assertStringNotContainsString('SECRET-KEY', json_encode($body));
        Log::shouldHaveReceived('info')->withArgs(fn ($m, $ctx = []) => ! str_contains(json_encode([$m, $ctx]), 'owner@fleet.de'));
        Log::shouldNotHaveReceived('info', fn ($m, $ctx = []) => str_contains(json_encode([$m, $ctx]), 'owner@fleet.de'));
    }

    public function test_account_email_is_ignored_when_it_is_not_an_email(): void
    {
        $tenant = $this->tenant();
        $this->register($tenant, 'not-an-email');

        $this->assertNull(app(PasskeyService::class)->accountEmailFor($tenant));
    }

    public function test_tenant_without_passkey_and_without_email_still_does_nothing(): void
    {
        Queue::fake();
        $tenant = $this->tenant();
        $this->needsOtp($tenant);
        Http::fake();
        $auto = app(AutoReloginService::class);

        $this->assertFalse($auto->onNeedsOtp($tenant->id));
        $auto->run($tenant->id);
        Http::assertNothingSent();
    }

    public function test_slot_caps_still_apply_to_passkey_tenants(): void
    {
        Queue::fake();
        $tenant = $this->tenant();
        $this->register($tenant);
        $this->needsOtp($tenant);
        $auto = app(AutoReloginService::class);

        $this->assertTrue($auto->onNeedsOtp($tenant->id));
        $this->assertFalse($auto->onNeedsOtp($tenant->id)); // MIN_GAP
    }
}
