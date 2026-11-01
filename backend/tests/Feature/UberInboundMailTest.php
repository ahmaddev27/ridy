<?php

namespace Tests\Feature;

use App\Console\Commands\IngestInboundMail;
use App\Domain\Audit\Models\AuditLog;
use App\Domain\Dispatch\AutoReloginService;
use App\Domain\Dispatch\Inbound\InboundMailHandler;
use App\Domain\Dispatch\Inbound\MimeParser;
use App\Domain\Dispatch\Inbound\ReplayGuard;
use App\Domain\Dispatch\LoginAttemptStore;
use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Dispatch\PasswordlessLoginSettings;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Jobs\AutoReloginJob;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\PendingCommand;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Variant B: the emailed code, the inbound handler and the automatic re-login. */
class UberInboundMailTest extends TestCase
{
    use RefreshDatabase;

    private const CODE = '0033';

    private Tenant $tenant;

    private string $address;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.passwordless_login.enabled' => true,
            'services.passwordless_login.tenants' => [],
            'services.passwordless_login.inbound_domain' => 'in.reidey.de',
            'services.uber_auth.url' => 'http://uber-auth.test:8791',
            'services.uber_auth.secret' => 'shh',
        ]);
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create([
            'name' => 'Acme', 'country' => 'DE', 'status' => 'active', 'activated_at' => now(),
            'settings' => ['passwordless_login' => ['enabled' => true]],
        ]);
        $manager = User::create(['name' => 'M', 'email' => 'm@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id]);
        $manager->assignRole('fleet_manager');
        SessionBrowser::create(['tenant_id' => $this->tenant->id, 'state' => 'needs_otp', 'last_seen_at' => now()]);
        app(TenantContext::class)->set($this->tenant->id);
        Sanctum::actingAs($manager);

        $settings = app(PasswordlessLoginSettings::class);
        $this->address = $settings->rotateInboundAddress($this->tenant);
        $settings->update($this->tenant, ['auto_code' => true, 'auto_relogin' => true, 'email' => 'ops@acme.de']);
        $this->tenant->refresh();
    }

    private function fakeUber(array $mfa = []): void
    {
        Http::fake([
            '*/login/start' => Http::response(['status' => 'mfa_required', 'login_id' => 'LID-1', 'channel' => 'unknown']),
            '*/login/mfa' => Http::response($mfa ?: ['status' => 'success', 'persistent' => true]),
            '*/login/cancel' => Http::response(['status' => 'cancelled']),
        ]);
    }

    private function startLogin(array $extra = []): void
    {
        $this->postJson('/api/v1/uber-login/start', ['email' => 'ops@acme.de'] + $extra)->assertStatus(202);
    }

    private function landCapture(): void
    {
        SessionBrowser::where('tenant_id', $this->tenant->id)->update(['last_capture_at' => now()]);
    }

    private function raw(array $o = []): string
    {
        $o += ['subject' => 'Do not share: '.self::CODE, 'id' => '<m1@uber.test>', 'date' => gmdate('r'), 'extra' => '', 'code' => self::CODE];

        return "From: Uber <admin@uber.com>\r\nTo: {$this->address}\r\nSubject: {$o['subject']}\r\nDate: {$o['date']}\r\n"
            ."Message-ID: {$o['id']}\r\n{$o['extra']}MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
            ."Your Uber verification code\r\n\r\nenter this verification code:\r\n\r\n{$o['code']}\r\n";
    }

    private function handler(): InboundMailHandler
    {
        return app(InboundMailHandler::class);
    }

    private function mfaSent(): bool
    {
        return Http::recorded(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/mfa'))->isNotEmpty();
    }

    public function test_happy_path_submits_the_emailed_code_through_the_same_path_as_the_manual_one(): void
    {
        $this->fakeUber();
        $this->startLogin();
        $this->landCapture();

        $this->assertSame('submitted', $this->handler()->handle($this->raw(), $this->address));

        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/mfa')
            && $r['login_id'] === 'LID-1' && $r['code'] === self::CODE && $r['company_key'] === (string) $this->tenant->id);
        $this->getJson('/api/v1/uber-login/status')->assertJsonPath('data.state', 'connected');
    }

    public function test_the_recipient_can_come_from_the_headers_when_the_mta_gives_none(): void
    {
        $this->fakeUber();
        $this->startLogin();

        $this->assertSame('submitted', $this->handler()->handle($this->raw()));
    }

    public function test_a_wrong_address_is_dropped_without_touching_uber(): void
    {
        $this->fakeUber();
        $this->startLogin();

        $other = 'uber-'.str_repeat('a', 26).'@in.reidey.de';
        $this->assertSame('unknown_address', $this->handler()->handle($this->raw(), $other));
        $this->assertSame('unknown_address', $this->handler()->handle($this->raw(), 'someone@in.reidey.de'));
        $this->assertFalse($this->mfaSent());
    }

    public function test_a_rotated_address_stops_working(): void
    {
        $this->fakeUber();
        $this->startLogin();
        $old = $this->address;
        app(PasswordlessLoginSettings::class)->rotateInboundAddress($this->tenant->refresh());

        $this->assertSame('unknown_address', $this->handler()->handle($this->raw(), $old));
        $this->assertFalse($this->mfaSent());
    }

    public function test_no_pending_attempt_means_drop(): void
    {
        Http::fake();

        $this->assertSame('no_pending', $this->handler()->handle($this->raw(), $this->address));
        Http::assertNothingSent();
    }

    public function test_a_manual_mode_attempt_ignores_emailed_codes(): void
    {
        $this->fakeUber();
        $this->startLogin(['mode' => 'manual']);

        $this->assertSame('no_pending', $this->handler()->handle($this->raw(), $this->address));
        $this->assertFalse($this->mfaSent());
    }

    public function test_the_same_message_id_is_never_processed_twice(): void
    {
        $this->fakeUber();
        $this->startLogin();

        // A mail without a code still consumes its Message-ID...
        $this->assertSame('no_code', $this->handler()->handle($this->raw(['subject' => 'Welcome', 'code' => 'nothing here']), $this->address));
        // ...so a replay of that id is refused while the login is still pending.
        $this->assertSame('replay', $this->handler()->handle($this->raw(), $this->address));
        $this->assertFalse($this->mfaSent());

        $this->assertSame('submitted', $this->handler()->handle($this->raw(['id' => '<m2@uber.test>']), $this->address));
    }

    public function test_the_replay_guard_is_one_shot(): void
    {
        $guard = new ReplayGuard;

        $this->assertTrue($guard->first('<a@b>'));
        $this->assertFalse($guard->first('<a@b>'));
        $this->assertTrue($guard->first('<c@d>'));
    }

    public function test_a_message_without_a_message_id_is_dropped(): void
    {
        $this->fakeUber();
        $this->startLogin();
        $raw = str_replace("Message-ID: <m1@uber.test>\r\n", '', $this->raw());

        $this->assertSame('no_message_id', $this->handler()->handle($raw, $this->address));
    }

    public function test_a_message_dated_before_the_login_is_stale(): void
    {
        $this->fakeUber();
        $this->startLogin();

        $this->assertSame('stale', $this->handler()->handle($this->raw(['date' => gmdate('r', time() - 3600)]), $this->address));
        $this->assertFalse($this->mfaSent());
    }

    public function test_an_absent_dkim_signature_does_not_reject_and_a_present_one_is_only_recorded(): void
    {
        $this->fakeUber();
        $this->startLogin();
        $this->assertSame('submitted', $this->handler()->handle($this->raw(), $this->address));
        $this->assertFalse(AuditLog::where('action', 'uber_login.inbound')->latest('id')->first()->context['dkim']);

        Cache::flush();
        $this->fakeUber();
        $this->startLogin();
        $signed = $this->raw(['id' => '<m9@uber.test>', 'extra' => "Authentication-Results: in.reidey.de; dkim=pass header.d=uber.com\r\n"]);
        $this->assertSame('submitted', $this->handler()->handle($signed, $this->address));
        $this->assertTrue(AuditLog::where('action', 'uber_login.inbound')->latest('id')->first()->context['dkim']);
    }

    public function test_only_the_company_with_auto_code_enabled_accepts_codes(): void
    {
        $this->fakeUber();
        $this->startLogin();
        app(PasswordlessLoginSettings::class)->update($this->tenant->refresh(), ['auto_code' => false]);

        $this->assertSame('not_enabled', $this->handler()->handle($this->raw(), $this->address));
        $this->assertFalse($this->mfaSent());
    }

    public function test_only_one_automated_try_then_the_manager_takes_over(): void
    {
        $this->fakeUber(['status' => 'mfa_required', 'retry' => true]);
        $this->startLogin();

        $this->assertSame('submitted', $this->handler()->handle($this->raw(), $this->address));
        $this->getJson('/api/v1/uber-login/status')->assertJsonPath('data.mode', 'manual')->assertJsonPath('data.state', 'awaiting_code');
        $this->assertSame('no_pending', $this->handler()->handle($this->raw(['id' => '<m2@uber.test>', 'subject' => 'Do not share: 1111']), $this->address));
        Http::assertSentCount(2); // start + the single automated mfa
    }

    public function test_the_code_and_the_email_body_are_never_persisted(): void
    {
        Queue::fake();
        $this->fakeUber();
        $this->startLogin();
        $this->landCapture();
        $this->handler()->handle($this->raw(), $this->address);

        $dump = json_encode([
            'cache' => Cache::get("uber_login:attempt:{$this->tenant->id}"),
            'audit' => AuditLog::all()->toArray(),
            'jobs' => DB::table('jobs')->get()->toArray(),
        ]);
        $this->assertStringNotContainsString(self::CODE, $dump);
        $this->assertStringNotContainsString('Do not share', $dump);
        $this->assertStringNotContainsString('verification code', $dump);
        $this->assertStringNotContainsString('<m1@uber.test>', $dump); // only its hash is kept, in the replay key
        Queue::assertNothingPushed();
    }

    /** The Postfix entry point with its STDIN replaced by $input. */
    private function ingest(string $input, ?string $rcpt = null): PendingCommand
    {
        $command = new class($input) extends IngestInboundMail
        {
            public function __construct(private readonly string $stdin)
            {
                parent::__construct();
            }

            protected function readInput(): string
            {
                return $this->stdin;
            }
        };
        $this->app->make(Kernel::class)->registerCommand($command);

        return $this->artisan('inbound-mail:ingest', $rcpt === null ? [] : ['--rcpt' => $rcpt]);
    }

    public function test_the_ingest_command_exits_cleanly_on_empty_or_oversize_input(): void
    {
        $this->ingest('')->assertExitCode(0);
        $this->ingest(str_repeat('x', 300000))->assertExitCode(0);
    }

    public function test_an_unknown_charset_is_dropped_or_read_never_tempfailed(): void
    {
        $this->fakeUber();
        $this->startLogin();
        $raw = str_replace('charset=UTF-8', 'charset=x-no-such-charset', $this->raw());

        // The parser itself never throws on it...
        $parsed = app(MimeParser::class)->parse($raw);
        $this->assertStringContainsString('verification code', $parsed->text);
        // ...and the Postfix command exits 0 (a retry storm is exit 75).
        $this->ingest($raw, $this->address)->assertExitCode(0);
        $this->assertTrue($this->mfaSent(), 'bytes were used as-is, so the ASCII code was still found');
    }

    public function test_garbage_input_is_dropped_with_exit_zero(): void
    {
        foreach (["\x00\xff\xfe not a mail", "Content-Type: multipart/mixed; boundary=\r\n\r\n--\r\n", "Content-Type: text/plain; charset=\r\n\r\nx", 'Subject: =?bogus?Q?x?='] as $junk) {
            $this->ingest($junk, $this->address)->assertExitCode(0);
            $this->ingest($junk)->assertExitCode(0);
        }
    }

    public function test_a_wrong_recipient_is_rejected_before_the_body_is_parsed_and_without_a_log_line(): void
    {
        Log::spy();
        $this->mock(MimeParser::class, fn ($mock) => $mock->shouldNotReceive('parse'));

        $this->assertSame('unknown_address', app(InboundMailHandler::class)->handle($this->raw(), 'uber-'.str_repeat('z', 26).'@in.reidey.de'));
        $this->assertSame('unknown_address', app(InboundMailHandler::class)->handle($this->raw(), 'bob@example.com'));

        Log::shouldNotHaveReceived('info');
    }

    public function test_the_audit_row_exists_only_when_the_code_was_really_relayed(): void
    {
        // An automatic attempt whose uber-auth start has not returned a login_id yet:
        // there is nothing to relay the code to, so nothing may be recorded as submitted.
        app(LoginAttemptStore::class)->put($this->tenant->id, [
            'state' => 'starting', 'login_id' => null, 'mode' => 'auto', 'auto_submitted' => false,
            'started_at' => now('Europe/Berlin')->toIso8601String(), 'expires_at' => now()->addMinutes(5)->toIso8601String(), 'submits' => 0,
        ]);
        Http::fake();

        $this->assertSame('not_relayed', $this->handler()->handle($this->raw(), $this->address));

        Http::assertNothingSent();
        $this->assertSame(0, AuditLog::where('action', 'uber_login.inbound')->count());
    }

    // --- automatic re-login -------------------------------------------------

    public function test_needs_otp_dispatches_the_job_with_the_tenant_id_only_when_every_gate_is_on(): void
    {
        Queue::fake();

        $this->assertTrue(app(AutoReloginService::class)->onNeedsOtp($this->tenant->id));
        Queue::assertPushed(AutoReloginJob::class, fn (AutoReloginJob $j) => $j->tenantId === $this->tenant->id);
    }

    public function test_each_gate_off_means_no_job(): void
    {
        Queue::fake();
        $service = app(AutoReloginService::class);
        $settings = app(PasswordlessLoginSettings::class);

        $settings->update($this->tenant, ['auto_relogin' => false]);
        $this->assertFalse($service->onNeedsOtp($this->tenant->id));

        $settings->update($this->tenant->refresh(), ['auto_relogin' => true, 'email' => null]);
        $this->assertFalse($service->onNeedsOtp($this->tenant->id));

        $settings->update($this->tenant->refresh(), ['email' => 'ops@acme.de']);
        config(['services.passwordless_login.enabled' => false]);
        $this->assertFalse($service->onNeedsOtp($this->tenant->id));

        Queue::assertNothingPushed();
    }

    public function test_auto_relogin_needs_auto_code_and_turning_it_off_turns_relogin_off(): void
    {
        $settings = app(PasswordlessLoginSettings::class);
        $settings->update($this->tenant, ['auto_code' => false]);

        $this->assertFalse($settings->autoReloginEnabled($this->tenant->refresh()));
        $this->assertFalse($this->tenant->settings['passwordless_login']['auto_relogin']);
    }

    public function test_the_daily_cap_is_two_and_attempts_are_spaced(): void
    {
        Queue::fake();
        $service = app(AutoReloginService::class);

        $this->assertTrue($service->onNeedsOtp($this->tenant->id));
        $this->assertFalse($service->onNeedsOtp($this->tenant->id), 'inside the minimum gap');

        $this->travel(16)->minutes();
        $this->assertTrue($service->onNeedsOtp($this->tenant->id));

        $this->travel(16)->minutes();
        $this->assertFalse($service->onNeedsOtp($this->tenant->id), 'third attempt in 24 h');

        $this->travel(25)->hours();
        $this->assertTrue($service->onNeedsOtp($this->tenant->id), 'a new day, a new budget');
        Queue::assertPushed(AutoReloginJob::class, 3);
    }

    public function test_the_job_starts_an_automatic_login_with_the_stored_email(): void
    {
        $this->fakeUber();

        (new AutoReloginJob($this->tenant->id))->handle(app(AutoReloginService::class));

        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/login/start') && $r['email'] === 'ops@acme.de');
        $this->getJson('/api/v1/uber-login/status')->assertJsonPath('data.mode', 'auto')->assertJsonPath('data.state', 'awaiting_code');
    }

    public function test_the_job_does_nothing_when_the_session_is_no_longer_in_needs_otp(): void
    {
        Http::fake();
        SessionBrowser::where('tenant_id', $this->tenant->id)->update(['state' => 'active', 'last_seen_at' => now()]);

        (new AutoReloginJob($this->tenant->id))->handle(app(AutoReloginService::class));

        Http::assertNothingSent();
    }

    public function test_the_browser_status_report_triggers_it_only_on_a_new_needs_otp(): void
    {
        Queue::fake();
        config(['services.dispatch.ingest_secret' => 'sec']);
        SessionBrowser::where('tenant_id', $this->tenant->id)->update(['state' => 'active']);
        $report = fn (string $state) => $this->withHeader('X-Dispatch-Secret', 'sec')
            ->postJson('/api/v1/internal/session-browser/status', ['browsers' => [['tenant_id' => $this->tenant->id, 'state' => $state]]])
            ->assertOk();

        $report('active');
        Queue::assertNothingPushed();
        $report('needs_otp');
        Queue::assertPushed(AutoReloginJob::class, 1);
        $report('needs_otp'); // the 20 s status push repeats the same state
        Queue::assertPushed(AutoReloginJob::class, 1);
    }

    public function test_the_company_options_and_the_secret_address_endpoints(): void
    {
        $fresh = Tenant::create(['name' => 'Fresh', 'country' => 'DE', 'status' => 'active', 'activated_at' => now(), 'settings' => ['passwordless_login' => ['enabled' => true]]]);
        $user = User::create(['name' => 'F', 'email' => 'f@fresh.de', 'password' => Hash::make('password'), 'tenant_id' => $fresh->id]);
        $user->assignRole('fleet_manager');
        Sanctum::actingAs($user);

        $this->putJson('/api/v1/uber-login/settings', ['auto_code' => true])->assertUnprocessable();

        $address = $this->postJson('/api/v1/uber-login/inbound-address/rotate')->assertOk()->json('data.inbound_address');
        $this->assertMatchesRegularExpression('/^uber-[a-z0-9]{26}@in\.reidey\.de$/', $address);
        // only the hash is stored: the token is nowhere in the settings
        $token = substr($address, 5, 26);
        $this->assertStringNotContainsString($token, json_encode($fresh->refresh()->settings));
        $this->assertNotEmpty($fresh->settings['passwordless_login']['inbound_token_hash']);

        $this->putJson('/api/v1/uber-login/settings', ['auto_code' => true, 'auto_relogin' => true, 'email' => 'ops@fresh.de'])
            ->assertOk()->assertJsonPath('data.inbound_configured', true)->assertJsonPath('data.auto_relogin', true)
            ->assertJsonMissingPath('data.inbound_token_hash');
        // the Uber account email is encrypted at rest
        $this->assertStringNotContainsString('ops@fresh.de', json_encode($fresh->refresh()->settings));
        $this->getJson('/api/v1/uber-login/settings')->assertJsonPath('data.email', 'ops@fresh.de');
    }

    public function test_the_new_routes_are_404_when_the_feature_is_closed_and_403_without_the_permission(): void
    {
        config(['services.passwordless_login.enabled' => false]);
        $this->getJson('/api/v1/uber-login/settings')->assertNotFound();
        $this->postJson('/api/v1/uber-login/inbound-address/rotate')->assertNotFound();

        config(['services.passwordless_login.enabled' => true]);
        $viewer = User::create(['name' => 'V', 'email' => 'v@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id]);
        $viewer->assignRole('viewer');
        Sanctum::actingAs($viewer);
        $this->postJson('/api/v1/uber-login/inbound-address/rotate')->assertForbidden();
    }
}
