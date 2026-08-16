<?php

namespace Tests\Feature;

use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\EmailTemplateRenderer;
use App\Domain\Notifications\Models\UserPushToken;
use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class NotifierTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
    }

    private function admin(): User
    {
        $u = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('x'), 'tenant_id' => null]);
        $u->assignRole('super_admin');

        return $u;
    }

    public function test_to_admins_targets_only_super_admins(): void
    {
        $admin = $this->admin();
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('x'), 'tenant_id' => $tenant->id]);
        $manager->assignRole('fleet_manager');

        app(Notifier::class)->toAdmins('company_registered', ['company' => 'Acme'], '/admin/companies');

        $this->assertSame(1, $admin->fresh()->notifications()->count());
        $this->assertSame(0, $manager->fresh()->notifications()->count());
        $this->assertSame('Acme', $admin->fresh()->notifications()->first()->data['params']['company']);
    }

    /** Capture pushes instead of hitting FCM; returns [spy, manager]. */
    private function spyManager(string $locale = 'de'): array
    {
        $spy = new class implements PushSender
        {
            public array $calls = [];

            public function send(string $deviceToken, string $title, string $body, array $data = []): bool
            {
                $this->calls[] = compact('title', 'body', 'data');

                return true;
            }
        };
        $this->app->instance(PushSender::class, $spy);

        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('x'), 'tenant_id' => $tenant->id, 'locale' => $locale]);
        $manager->assignRole('fleet_manager');
        UserPushToken::create(['user_id' => $manager->id, 'token' => 'web-1']);

        return [$spy, $manager, $tenant];
    }

    public function test_event_sends_localized_web_push_to_registered_users(): void
    {
        [$spy, , $tenant] = $this->spyManager('en');

        app(Notifier::class)->toTenant($tenant->id, 'subscription_activated', ['days' => 30], '/mySubscription');

        $this->assertCount(1, $spy->calls);
        $this->assertSame('Subscription active', $spy->calls[0]['title']);
        $this->assertSame('Your subscription runs for 30 days.', $spy->calls[0]['body']);
        $this->assertSame('subscription_activated', $spy->calls[0]['data']['type']);
    }

    public function test_push_false_stores_the_bell_but_skips_web_push(): void
    {
        [$spy, $manager, $tenant] = $this->spyManager();

        app(Notifier::class)->toTenant($tenant->id, 'offer', ['fare' => '€7'], '/offers', push: false);

        $this->assertCount(0, $spy->calls, 'no external push for high-frequency events');
        $this->assertSame(1, $manager->fresh()->notifications()->count(), 'still stored in the bell');
    }

    public function test_important_event_also_emails_the_user_in_their_language(): void
    {
        // The test mailer is the array transport (phpunit.xml) — inspect what it captured.
        $transport = Mail::mailer()->getSymfonyTransport();

        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('x'), 'tenant_id' => $tenant->id, 'locale' => 'en']);
        $manager->assignRole('fleet_manager');

        app(Notifier::class)->toTenant($tenant->id, 'subscription_expired', [], '/subscription');

        $messages = $transport->messages();
        $this->assertCount(1, $messages);
        $this->assertSame('Subscription expired', $messages[0]->getOriginalMessage()->getSubject());
        $this->assertStringContainsString('m@a.de', $messages[0]->getEnvelope()->getRecipients()[0]->getAddress());
    }

    public function test_notification_email_template_renders_the_event_copy(): void
    {
        $rendered = app(EmailTemplateRenderer::class)->render('notification', [
            'title' => 'Subscription expired',
            'body' => 'Your subscription has expired.',
            'action_url' => 'https://r.fleeteye.de/subscription',
            'action_label' => 'Open',
        ]);

        $this->assertStringContainsString('Subscription expired', $rendered['subject']);
        $this->assertStringContainsString('Your subscription has expired.', $rendered['html']);
        $this->assertStringContainsString('https://r.fleeteye.de/subscription', $rendered['html']);
    }

    public function test_dedupe_skips_a_second_unread_of_the_same_type(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('x'), 'tenant_id' => $tenant->id]);
        $manager->assignRole('fleet_manager');

        $notifier = app(Notifier::class);
        $notifier->toTenant($tenant->id, 'session_needs_relink', [], '/connections', dedupe: true);
        $notifier->toTenant($tenant->id, 'session_needs_relink', [], '/connections', dedupe: true);

        // Deduped: still only one unread of that type.
        $this->assertSame(1, $manager->fresh()->unreadNotifications()->count());
    }
}
