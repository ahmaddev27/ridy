<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\Models\DispatchNetworkLog;
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
        $this->sessionExpiring($this->tenant(), 'supplier_token_expires_at', CarbonImmutable::now()->addHours(5));

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
        $this->sessionExpiring($tenant, 'supplier_token_expires_at', CarbonImmutable::now()->addHours(2));
        $this->artisan('alerts:check')->assertSuccessful();

        $this->sessionExpiring($tenant, 'supplier_token_expires_at', CarbonImmutable::now()->addHours(30));
        $this->artisan('alerts:check')->assertSuccessful();
        Bus::assertDispatchedTimes(SendRenderedMail::class, 1);

        $this->travel(20)->hours();
        $this->artisan('alerts:check')->assertSuccessful();

        Bus::assertDispatchedTimes(SendRenderedMail::class, 2);
    }

    public function test_an_expiring_jwt_session_does_not_alert(): void
    {
        config(['services.alerts.email' => 'ops@reidey.de']);
        Bus::fake();
        $this->sessionExpiring($this->tenant(), 'session_token_expires_at', CarbonImmutable::now()->addHours(5));

        $this->artisan('alerts:check')->assertSuccessful();

        Bus::assertNotDispatched(SendRenderedMail::class);
        $this->assertSame(0, AlertIncident::where('kind', 'token_expiry')->count());
    }

    public function test_an_open_incident_for_the_dropped_column_is_resolved_not_stranded(): void
    {
        config(['services.alerts.email' => 'ops@reidey.de']);
        Bus::fake();
        $session = $this->sessionExpiring($this->tenant(), 'session_token_expires_at', CarbonImmutable::now()->addHours(5));
        $legacy = AlertIncident::create([
            'key' => "token_expiry:{$session->id}:session_token_expires_at:".now()->addHours(5)->getTimestamp(),
            'kind' => 'token_expiry', 'title' => 'legacy', 'opened_at' => now(),
        ]);

        $this->artisan('alerts:check')->assertSuccessful();

        $this->assertNotNull($legacy->fresh()->resolved_at);
    }

    /** Stores a session, then captures $incoming over it; returns [stored session after, in-memory jars]. */
    private function recapture(array $stored, array $incoming, string $via): UberFleetSession
    {
        $tenant = $this->tenant();
        $service = app(FleetSessionService::class);
        $service->capture($tenant, self::ORG, $this->ramenJar($stored['ramen']), supplierCookies: $this->supplierJar($stored['supplier']), via: 'manual');

        return $service->capture($tenant, self::ORG, $this->ramenJar($incoming['ramen']), supplierCookies: $this->supplierJar($incoming['supplier']), via: $via)->fresh();
    }

    private function ramenJar(?CarbonImmutable $exp): array
    {
        return [['name' => 'sid', 'value' => 'x'], ['name' => 'jwt-session', 'value' => $this->jwt($exp ? ['exp' => $exp->timestamp] : ['sub' => 'x'])]];
    }

    private function supplierJar(?CarbonImmutable $exp): array
    {
        return [['name' => 'csid', 'value' => 'y'], ['name' => 'sp-jwt-session', 'value' => $this->jwt($exp ? ['exp' => $exp->timestamp] : ['sub' => 'x'])]];
    }

    public function test_an_automatic_capture_never_downgrades_the_supplier_jar(): void
    {
        $new = CarbonImmutable::now()->addDays(10)->startOfSecond();
        $old = $new->subDays(7);
        $r = CarbonImmutable::now()->addHours(10)->startOfSecond();

        $session = $this->recapture(['ramen' => $r, 'supplier' => $new], ['ramen' => $r, 'supplier' => $old], 'auto');

        $this->assertSame($new->timestamp, $session->supplier_token_expires_at->timestamp);
        $this->assertSame($new->timestamp, SessionTokenExpiry::fromJar($session->supplier_cookies, 'sp-jwt-session')->timestamp);
        $this->assertSame(1, DispatchNetworkLog::where('kind', 'session')->count());
    }

    public function test_an_automatic_capture_with_a_newer_token_replaces_the_jar(): void
    {
        $old = CarbonImmutable::now()->addDays(3)->startOfSecond();
        $new = $old->addDays(7);
        $r = CarbonImmutable::now()->addHours(10)->startOfSecond();

        $session = $this->recapture(['ramen' => $r, 'supplier' => $old], ['ramen' => $r, 'supplier' => $new], 'page');

        $this->assertSame($new->timestamp, $session->supplier_token_expires_at->timestamp);
        $this->assertSame(0, DispatchNetworkLog::where('kind', 'session')->count());
    }

    public function test_a_manual_capture_replaces_the_jar_even_with_an_older_token(): void
    {
        $new = CarbonImmutable::now()->addDays(10)->startOfSecond();
        $old = $new->subDays(7);
        $r = CarbonImmutable::now()->addHours(10)->startOfSecond();

        $session = $this->recapture(['ramen' => $r, 'supplier' => $new], ['ramen' => $r->subHours(5), 'supplier' => $old], 'manual');

        $this->assertSame($old->timestamp, $session->supplier_token_expires_at->timestamp);
        $this->assertSame($r->subHours(5)->timestamp, $session->session_token_expires_at->timestamp);
    }

    public function test_a_missing_token_on_either_side_never_blocks(): void
    {
        $t = CarbonImmutable::now()->addDays(10)->startOfSecond();

        $incomingNull = $this->recapture(['ramen' => $t, 'supplier' => $t], ['ramen' => null, 'supplier' => null], 'auto');
        $this->assertNull($incomingNull->supplier_token_expires_at);
        $this->assertNull($incomingNull->session_token_expires_at);
    }

    public function test_a_stored_session_without_a_token_accepts_any_incoming_jar(): void
    {
        $t = CarbonImmutable::now()->addDays(2)->startOfSecond();

        $session = $this->recapture(['ramen' => null, 'supplier' => null], ['ramen' => $t, 'supplier' => $t], 'auto');

        $this->assertSame($t->timestamp, $session->supplier_token_expires_at->timestamp);
        $this->assertSame($t->timestamp, $session->session_token_expires_at->timestamp);
    }

    public function test_the_two_jars_are_judged_independently(): void
    {
        $t = CarbonImmutable::now()->addDays(5)->startOfSecond();

        // RAMEN incoming is older (kept); supplier incoming is newer (taken).
        $session = $this->recapture(['ramen' => $t, 'supplier' => $t], ['ramen' => $t->subHours(3), 'supplier' => $t->addDays(2)], 'auto');

        $this->assertSame($t->timestamp, $session->session_token_expires_at->timestamp);
        $this->assertSame($t->addDays(2)->timestamp, $session->supplier_token_expires_at->timestamp);
    }
}
