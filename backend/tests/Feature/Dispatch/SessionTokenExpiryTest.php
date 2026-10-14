<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\SessionTokenExpiry;
use App\Domain\Notifications\Jobs\SendRenderedMail;
use App\Domain\Ops\Models\AlertIncident;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Tests\TestCase;

class SessionTokenExpiryTest extends TestCase
{
    use RefreshDatabase;

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    private function jwt(array $claims): string
    {
        $b64 = fn (array $a) => rtrim(strtr(base64_encode((string) json_encode($a)), '+/', '-_'), '=');

        return $b64(['alg' => 'ES256']).'.'.$b64($claims).'.sig';
    }

    private function tenant(): Tenant
    {
        return Tenant::create(['name' => 'Smoothfahrt', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
    }

    private function sessionExpiring(Tenant $tenant, string $column, ?CarbonImmutable $at): UberFleetSession
    {
        return UberFleetSession::withoutGlobalScopes()->updateOrCreate(
            ['tenant_id' => $tenant->id, 'uber_org_uuid' => self::ORG],
            ['cookies' => [], 'status' => 'active', $column => $at],
        );
    }

    public function test_reads_exp_from_a_real_shaped_jwt(): void
    {
        $exp = CarbonImmutable::parse('2026-10-15 00:16:00');
        $read = SessionTokenExpiry::jwtExpiry($this->jwt(['iat' => $exp->subDay()->timestamp, 'exp' => $exp->timestamp, 'sub' => 'x']));

        $this->assertSame($exp->timestamp, $read?->timestamp);
    }

    public function test_non_jwt_malformed_and_expless_tokens_are_null(): void
    {
        $this->assertNull(SessionTokenExpiry::jwtExpiry('GA1.2.123456.789'));
        $this->assertNull(SessionTokenExpiry::jwtExpiry('a.!!!notbase64!!!.c'));
        $this->assertNull(SessionTokenExpiry::jwtExpiry('a.'.base64_encode('not json').'.c'));
        $this->assertNull(SessionTokenExpiry::jwtExpiry($this->jwt(['sub' => 'x'])));
    }

    public function test_capture_stores_both_expiries(): void
    {
        $ramen = CarbonImmutable::now()->addDay()->startOfSecond();
        $supplier = CarbonImmutable::now()->addDays(14)->startOfSecond();

        $session = app(FleetSessionService::class)->capture(
            $this->tenant(), self::ORG,
            [['name' => 'sid', 'value' => 'x'], ['name' => 'jwt-session', 'value' => $this->jwt(['exp' => $ramen->timestamp])]],
            supplierCookies: [['name' => 'sp-jwt-session', 'value' => $this->jwt(['exp' => $supplier->timestamp])]],
        );

        $fresh = $session->fresh();
        $this->assertSame($ramen->timestamp, $fresh->session_token_expires_at->timestamp);
        $this->assertSame($supplier->timestamp, $fresh->supplier_token_expires_at->timestamp);
    }

    public function test_capture_without_jwt_cookies_leaves_expiries_null(): void
    {
        $session = app(FleetSessionService::class)->capture(
            $this->tenant(), self::ORG,
            [['name' => 'sid', 'value' => 'x']],
            supplierCookies: [['name' => 'csid', 'value' => 'y']],
        );

        $this->assertNull($session->fresh()->session_token_expires_at);
        $this->assertNull($session->fresh()->supplier_token_expires_at);
    }

    public function test_capture_without_a_supplier_jar_keeps_the_stored_supplier_expiry(): void
    {
        $tenant = $this->tenant();
        $supplier = CarbonImmutable::now()->addDays(10)->startOfSecond();
        $this->sessionExpiring($tenant, 'supplier_token_expires_at', $supplier);

        $session = app(FleetSessionService::class)->capture($tenant, self::ORG, [['name' => 'sid', 'value' => 'x']]);

        $this->assertSame($supplier->timestamp, $session->fresh()->supplier_token_expires_at->timestamp);
    }

    public function test_alert_fires_once_inside_the_window_and_not_twice(): void
    {
        config(['services.alerts.email' => 'ops@reidey.de']);
        Bus::fake();
        $this->sessionExpiring($this->tenant(), 'session_token_expires_at', CarbonImmutable::now()->addHours(5));

        $this->artisan('alerts:check')->assertSuccessful();
        $this->artisan('alerts:check')->assertSuccessful();

        Bus::assertDispatchedTimes(SendRenderedMail::class, 1);
        $this->assertSame(1, AlertIncident::where('kind', 'token_expiry')->count());
        $this->assertStringContainsString('Smoothfahrt', AlertIncident::where('kind', 'token_expiry')->value('title'));
    }

    public function test_no_alert_outside_the_window_or_for_an_already_expired_token(): void
    {
        config(['services.alerts.email' => 'ops@reidey.de']);
        Bus::fake();
        $tenant = $this->tenant();
        $this->sessionExpiring($tenant, 'supplier_token_expires_at', CarbonImmutable::now()->addDays(3));
        $this->sessionExpiring($tenant, 'session_token_expires_at', CarbonImmutable::now()->subDays(13));

        $this->artisan('alerts:check')->assertSuccessful();

        Bus::assertNotDispatched(SendRenderedMail::class);
        $this->assertSame(0, AlertIncident::where('kind', 'token_expiry')->count());
    }

    public function test_a_renewed_token_alerts_again_for_its_new_expiry(): void
    {
        config(['services.alerts.email' => 'ops@reidey.de']);
        Bus::fake();
        $tenant = $this->tenant();
        $this->sessionExpiring($tenant, 'session_token_expires_at', CarbonImmutable::now()->addHours(2));
        $this->artisan('alerts:check')->assertSuccessful();

        $this->sessionExpiring($tenant, 'session_token_expires_at', CarbonImmutable::now()->addHours(30));
        $this->artisan('alerts:check')->assertSuccessful();
        Bus::assertDispatchedTimes(SendRenderedMail::class, 1);

        $this->travel(20)->hours();
        $this->artisan('alerts:check')->assertSuccessful();

        Bus::assertDispatchedTimes(SendRenderedMail::class, 2);
    }
}
