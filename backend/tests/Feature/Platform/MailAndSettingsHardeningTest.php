<?php

namespace Tests\Feature\Platform;

use App\Domain\Notifications\EmailHtmlSanitizer;
use App\Domain\Notifications\EmailTemplateRenderer;
use App\Domain\Notifications\Jobs\SendRenderedMail;
use App\Domain\Notifications\SendTemplatedMail;
use App\Domain\Ops\AlertService;
use App\Models\EmailTemplate;
use App\Models\User;
use App\Support\Settings;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MailAndSettingsHardeningTest extends TestCase
{
    use RefreshDatabase;

    public function test_settings_cache_never_holds_decrypted_secrets(): void
    {
        Settings::setMany(['smtp_password' => 'topsecret', 'smtp_host' => 'mail.example']);

        $this->assertSame('topsecret', Settings::get('smtp_password'));
        $this->assertSame('mail.example', Settings::all()['smtp_host']);

        $cached = Cache::get('platform_settings.v2');
        $this->assertIsArray($cached);
        $this->assertNotSame('topsecret', $cached['smtp_password']);
        $this->assertStringNotContainsString('topsecret', serialize($cached));
    }

    public function test_templated_mail_is_queued_not_sent_inline(): void
    {
        Queue::fake();
        EmailTemplate::updateOrCreate(['key' => 'password_otp'], ['subject' => 'Code {{otp}}', 'body_html' => '<p>{{otp}}</p>']);

        SendTemplatedMail::to('a@b.de', 'password_otp', ['name' => 'X', 'otp' => '123456']);

        Queue::assertPushed(SendRenderedMail::class, fn (SendRenderedMail $job) => $job->to === 'a@b.de'
            && $job->subject === 'Code 123456'
            && str_contains($job->body, '123456'));
        // OTP mail must not wait behind slow geocode/trip jobs on `default`.
        Queue::assertPushedOn('mail', SendRenderedMail::class);
    }

    public function test_the_scheduler_drain_serves_every_dispatch_queue(): void
    {
        $event = collect(app(Schedule::class)->events())
            ->first(fn ($e) => str_contains((string) $e->command, 'queue:work'));

        $this->assertNotNull($event);
        $this->assertStringContainsString('--queue=push,mail,default', (string) $event->command);
    }

    public function test_ops_alert_is_logged_and_queued(): void
    {
        Queue::fake();
        config(['services.alerts.email' => 'ops@reidey.de']);

        app(AlertService::class)->open('shard_down:9', 'shard_down', 'Shard down');

        Queue::assertPushed(SendRenderedMail::class, fn (SendRenderedMail $job) => $job->to === 'ops@reidey.de' && $job->html === false);
    }

    public function test_subject_variables_are_not_html_escaped_but_body_ones_are(): void
    {
        $template = new EmailTemplate(['subject' => '{{company_name}} lädt dich zu Reidey ein', 'body_html' => '<p>{{company_name}}</p>']);
        $template->key = 'driver_invite';

        $rendered = app(EmailTemplateRenderer::class)->renderTemplate($template, ['company_name' => 'Y&A "Test"']);

        $this->assertSame('Y&A "Test" lädt dich zu Reidey ein', $rendered['subject']);
        $this->assertStringContainsString('Y&amp;A', $rendered['html']);
    }

    public function test_sanitizer_blocks_known_blocklist_bypasses_and_keeps_formatting(): void
    {
        $s = new EmailHtmlSanitizer;

        $out = $s->sanitize(
            '<p>Hi <b>there</b></p>'
            .'<img src=x/onerror=alert(1)>'
            .'<a href="jav&#x61;script:alert(1)">x</a>'
            .'<button formaction=javascript:alert(1)>b</button>'
            .'<svg><script>alert(1)</script></svg>'
            .'<a class="btn" href="{{action_url}}">{{action_label}}</a>'
            .'<a href="https://reidey.de">ok</a>'
        );

        // "x/onerror=alert(1)" may survive only as an inert relative src value — never as an attribute.
        $this->assertDoesNotMatchRegularExpression('/\son\w+\s*=/i', $out);
        $this->assertStringNotContainsStringIgnoringCase('javascript', $out);
        $this->assertStringNotContainsStringIgnoringCase('<button', $out);
        $this->assertStringNotContainsStringIgnoringCase('<script', $out);
        $this->assertStringNotContainsStringIgnoringCase('<svg', $out);
        $this->assertStringContainsString('<b>there</b>', $out);
        $this->assertStringContainsString('href="{{action_url}}"', $out);
        $this->assertStringContainsString('{{action_label}}', $out);
        $this->assertStringContainsString('href="https://reidey.de"', $out);
        $this->assertStringContainsString('class="btn"', $out);
    }

    public function test_saving_a_template_stores_sanitized_html(): void
    {
        EmailTemplate::updateOrCreate(['key' => 'company_otp'], ['subject' => 's', 'body_html' => '<p>x</p>']);
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'root@reidey.de', 'password' => 'x', 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);

        $this->putJson('/api/v1/admin/email-templates/company_otp', [
            'subject' => 's',
            'body_html' => '<p>ok</p><img src=x onerror=alert(1)>',
        ])->assertOk();

        $this->assertStringNotContainsString('onerror', (string) EmailTemplate::find('company_otp')->body_html);
    }
}
