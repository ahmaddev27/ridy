<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Full co-browse first login (docs/28 §11): the human drives Uber's whole sign-in; no email or code reaches us. */
class UberLoginFullCobrowseTest extends TestCase
{
    use RefreshDatabase;

    private const LOGIN_ID = 'LID-FULL-11';

    private Tenant $tenant;

    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.passwordless_login.enabled' => true,
            'services.passwordless_login.tenants' => [],
            'services.passwordless_login.cold' => true,
            'services.passwordless_login.cobrowse' => true,
            'services.uber_auth.url' => 'http://uber-auth.test:8791',
            'services.uber_auth.secret' => 'shh',
        ]);
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = $this->makeTenant('Acme', true);
        $this->manager = $this->makeUser($this->tenant);
        app(TenantContext::class)->set($this->tenant->id);
        Sanctum::actingAs($this->manager);
        Cache::flush();
        RateLimiter::clear('uber-login-cobrowse:'.$this->tenant->id);
    }

    private function makeTenant(string $name, bool $cobrowse): Tenant
    {
        return Tenant::create([
            'name' => $name, 'country' => 'DE', 'status' => 'active', 'activated_at' => now(),
            'proxy_url' => 'http://u:p@proxy.test:8000',
            'settings' => ['passwordless_login' => ['enabled' => true] + ($cobrowse ? ['cobrowse' => true] : [])],
        ]);
    }

    private function makeUser(Tenant $tenant): User
    {
        $user = User::create(['name' => 'm', 'email' => 'm'.$tenant->id.'@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole('fleet_manager');

        return $user;
    }

    /** @param  array<string, mixed>  $resume */
    private function fakeFull(array $resume = ['status' => 'challenge_required', 'challenge' => 'human_login']): void
    {
        Http::fake([
            '*/login/start' => Http::response(['status' => 'challenge_required', 'login_id' => self::LOGIN_ID, 'challenge' => 'human_login', 'expires_at' => now()->addMinutes(10)->toIso8601String()]),
            '*/login/resume' => Http::response($resume),
            '*/login/cancel' => Http::response(['status' => 'cancelled']),
        ]);
    }

    public function test_cold_cobrowse_start_needs_no_email_and_parks_as_human_login(): void
    {
        $this->fakeFull();

        $res = $this->postJson('/api/v1/uber-login/start', [])->assertStatus(202)
            ->assertJsonPath('data.state', 'awaiting_challenge')
            ->assertJsonPath('data.challenge', 'human_login')
            ->assertJsonPath('data.cobrowse_available', true)
            ->assertJsonMissingPath('data.login_id');
        $this->assertStringNotContainsString(self::LOGIN_ID, $res->getContent());
        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/start')
            && $r['full'] === true && $r['cobrowse'] === true && $r['cold'] === true);

        $this->postJson('/api/v1/uber-login/cobrowse')->assertCreated();
        $this->getJson('/api/v1/uber-login/status')->assertJsonPath('data.challenge', 'human_login');
    }

    public function test_resume_success_with_a_landed_capture_connects(): void
    {
        $this->fakeFull(['status' => 'success']);
        $this->postJson('/api/v1/uber-login/start', [])->assertStatus(202);
        SessionBrowser::create(['tenant_id' => $this->tenant->id, 'state' => 'active', 'last_seen_at' => now(), 'last_capture_at' => now()->addSecond()]);

        $this->getJson('/api/v1/uber-login/status')->assertOk()->assertJsonPath('data.state', 'connected');
    }

    public function test_resume_success_without_a_capture_fails(): void
    {
        $this->fakeFull(['status' => 'success']);
        $this->postJson('/api/v1/uber-login/start', [])->assertStatus(202);

        $this->getJson('/api/v1/uber-login/status')->assertJsonPath('data.failure', 'capture_failed');
    }

    public function test_resume_keeps_waiting_while_the_human_is_still_logging_in(): void
    {
        $this->fakeFull();
        $this->postJson('/api/v1/uber-login/start', []);

        $this->getJson('/api/v1/uber-login/status')->assertJsonPath('data.state', 'awaiting_challenge')
            ->assertJsonPath('data.challenge', 'human_login');
    }

    /** @return array<string, array{0: array<string, mixed>}> */
    public static function ends(): array
    {
        return [
            'failed' => [['status' => 'challenge_failed'], 'challenge_failed'],
            'timeout' => [['status' => 'challenge_timeout'], 'challenge_timeout'],
            'mfa never relayed' => [['status' => 'mfa_required', 'login_id' => 'x'], 'cobrowse_unavailable'],
        ];
    }

    /** @dataProvider ends */
    #[DataProvider('ends')]
    public function test_resume_ends_fail_and_never_enter_the_code_flow(array $answer, string $failure): void
    {
        $this->fakeFull($answer);
        $this->postJson('/api/v1/uber-login/start', []);

        $this->getJson('/api/v1/uber-login/status')->assertJsonPath('data.state', 'failed')->assertJsonPath('data.failure', $failure);
    }

    public function test_a_refused_full_start_falls_back_to_the_automated_path_when_an_email_was_sent(): void
    {
        Http::fake([
            '*/login/start' => Http::sequence()
                ->push(['status' => 'full_login_unavailable'], 409)
                ->push(['status' => 'mfa_required', 'login_id' => self::LOGIN_ID, 'channel' => 'email']),
        ]);

        $this->postJson('/api/v1/uber-login/start', ['email' => 'ops@acme.de'])->assertStatus(202)
            ->assertJsonPath('data.state', 'awaiting_code');
        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/start') && ! isset($r['full']) && $r['email'] === 'ops@acme.de');
    }

    public function test_a_refused_full_start_without_an_email_is_a_clean_failure(): void
    {
        Http::fake(['*/login/start' => Http::response(['status' => 'full_login_unavailable'], 409)]);

        $this->postJson('/api/v1/uber-login/start', [])->assertOk()->assertJsonPath('data.failure', 'full_login_unavailable');
        Http::assertSentCount(1);
    }

    public function test_a_company_without_cobrowse_still_needs_an_email(): void
    {
        $other = $this->makeTenant('Plain', false);
        Sanctum::actingAs($this->makeUser($other));
        Http::fake();

        $this->postJson('/api/v1/uber-login/start', [])->assertUnprocessable();
        Http::assertNothingSent();
    }

    public function test_me_exposes_full_cobrowse_only_for_a_cold_cobrowse_company(): void
    {
        $this->getJson('/api/v1/me')->assertJsonPath('data.tenant.full_cobrowse_available', true);
        // Migrated (co-browse on) but server-sync not enabled yet: the extension is NOT retired
        // (no dark period — H1). It flips on only once server-sync is enabled for the company.
        $this->getJson('/api/v1/me')->assertJsonPath('data.tenant.extension_retired', false);
        config(['services.uber.server_sync' => true]);
        $this->getJson('/api/v1/me')->assertJsonPath('data.tenant.extension_retired', true);
        $this->tenant->setCobrowseEnabled(false);
        $this->getJson('/api/v1/me')->assertJsonPath('data.tenant.extension_retired', false);
        $this->tenant->setCobrowseEnabled(true);

        SessionBrowser::create(['tenant_id' => $this->tenant->id, 'state' => 'needs_otp', 'last_seen_at' => now()]);
        $this->getJson('/api/v1/me')->assertJsonPath('data.tenant.full_cobrowse_available', false);
    }
}
