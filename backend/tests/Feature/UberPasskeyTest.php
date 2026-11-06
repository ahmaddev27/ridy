<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\Models\UberPasskey;
use App\Domain\Dispatch\PasskeySettings;
use App\Domain\Dispatch\UberAuthClient;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Mockery\MockInterface;
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
            'settings' => ['passkey' => ['enabled' => $perTenant]],
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

        $unset = Tenant::create(['name' => 'U', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
        $this->assertTrue($settings->availableFor($unset), 'no passkey settings = on by default');

        config(['services.passkey.tenants' => ['999999']]);
        $this->assertFalse($settings->availableFor($tenant), 'not allowlisted');

        config(['services.passkey.tenants' => [(string) $tenant->id]]);
        $this->assertTrue($settings->availableFor($tenant));
    }

    public function test_failure_is_recorded_without_downgrading_a_live_passkey(): void
    {
        $this->enable();
        $tenant = $this->tenant();
        $url = "/api/v1/internal/session-browser/{$tenant->id}/passkey/failure";

        $this->withHeader('X-Dispatch-Secret', self::SECRET)->postJson($url, ['reason' => 'session_lost'])->assertOk();
        $row = UberPasskey::withoutGlobalScopes()->first();
        $this->assertSame(UberPasskey::STATUS_FAILED, $row->status);
        $this->assertNull($row->credential);

        $this->sendCredential($tenant, $this->credential())->assertOk();
        $this->withHeader('X-Dispatch-Secret', self::SECRET)->postJson($url, ['reason' => 'session_lost'])->assertOk();
        $this->assertSame(UberPasskey::STATUS_ACTIVE, UberPasskey::withoutGlobalScopes()->first()->status);
    }

    private function sessionFor(Tenant $tenant): void
    {
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'uber_org_uuid' => 'org-'.$tenant->id, 'status' => UberFleetSession::STATUS_ACTIVE,
            'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);
    }

    public function test_backfill_is_a_dry_run_by_default(): void
    {
        $this->enable();
        $tenant = $this->tenant();
        $this->sessionFor($tenant);
        $this->mock(UberAuthClient::class, fn (MockInterface $m) => $m->shouldNotReceive('registerPasskey'));

        $this->artisan('uber:passkey-backfill', ['--tenant' => $tenant->id])->assertSuccessful()
            ->expectsOutputToContain('Dry run');
    }

    public function test_backfill_refuses_fleet_wide_without_confirm(): void
    {
        $this->enable();
        $this->mock(UberAuthClient::class, fn (MockInterface $m) => $m->shouldNotReceive('registerPasskey'));

        $this->artisan('uber:passkey-backfill', ['--run' => true])->assertFailed();
    }

    public function test_backfill_registers_exactly_the_one_requested_tenant(): void
    {
        $this->enable();
        $one = $this->tenant();
        $other = $this->tenant();
        $this->sessionFor($one);
        $this->sessionFor($other);
        $this->mock(UberAuthClient::class, function (MockInterface $m) use ($one) {
            $m->shouldReceive('configured')->andReturnTrue();
            $m->shouldReceive('registerPasskey')->once()->with($one->id)->andReturn(['status' => 'registered']);
        });

        $this->artisan('uber:passkey-backfill', ['--tenant' => $one->id, '--run' => true])->assertSuccessful();
    }

    public function test_backfill_skips_companies_with_the_company_flag_off(): void
    {
        $this->enable();
        $off = $this->tenant(false);
        $this->sessionFor($off);
        $this->mock(UberAuthClient::class, fn (MockInterface $m) => $m->shouldNotReceive('registerPasskey'));

        $this->artisan('uber:passkey-backfill', ['--tenant' => $off->id, '--run' => true])->assertSuccessful();
    }

    public function test_backfill_halts_the_run_when_a_session_is_lost(): void
    {
        $this->enable();
        $a = $this->tenant();
        $b = $this->tenant();
        $this->sessionFor($a);
        $this->sessionFor($b);
        $this->mock(UberAuthClient::class, function (MockInterface $m) {
            $m->shouldReceive('configured')->andReturnTrue();
            $m->shouldReceive('registerPasskey')->once()->andReturn(['status' => 'session_lost']);
        });

        $this->artisan('uber:passkey-backfill', ['--run' => true, '--confirm' => true, '--sleep' => 0])->assertFailed();
    }

    public function test_credential_endpoint_returns_the_cdp_ready_shape_only_when_enabled_and_active(): void
    {
        $tenant = $this->tenant();
        $url = "/api/v1/internal/session-browser/{$tenant->id}/passkey/credential";
        $get = fn () => $this->withHeader('X-Dispatch-Secret', self::SECRET)->getJson($url);

        $this->enable();
        $get()->assertNotFound(); // nothing registered yet

        $this->sendCredential($tenant, $this->credential() + ['account' => 'a@b.de'])->assertOk();
        $get()->assertOk()->assertExactJson(['data' => [
            'credentialId' => 'cred-abc', 'isResidentCredential' => true, 'rpId' => 'uber.com',
            'privateKey' => 'PRIVATE-KEY-MATERIAL', 'userHandle' => 'uh', 'signCount' => 0,
        ]]);

        config(['services.passkey.enabled' => false]);
        $get()->assertNotFound(); // global flag off => no key leaves
    }
}
