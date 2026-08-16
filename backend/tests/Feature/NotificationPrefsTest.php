<?php

namespace Tests\Feature;

use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\UserPushToken;
use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class NotificationPrefsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
    }

    /** Capture pushes instead of hitting FCM. */
    private function pushSpy(): object
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

        return $spy;
    }

    public function test_disabling_email_for_a_category_keeps_bell_and_push_but_drops_email(): void
    {
        $spy = $this->pushSpy();
        $transport = Mail::mailer()->getSymfonyTransport();

        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create([
            'name' => 'M',
            'email' => 'm@a.de',
            'password' => Hash::make('x'),
            'tenant_id' => $tenant->id,
            'locale' => 'en',
            // Email off for "subscription"; every other channel/category default (on).
            'notification_prefs' => ['email' => ['subscription' => false]],
        ]);
        $manager->assignRole('fleet_manager');
        UserPushToken::create(['user_id' => $manager->id, 'token' => 'web-1']);

        $notifier = app(Notifier::class);

        // Subscription event: bell + push, but NO email.
        $notifier->toTenant($tenant->id, 'subscription_expired', [], '/subscription');

        $this->assertSame(1, $manager->fresh()->notifications()->count(), 'bell still written');
        $this->assertCount(1, $spy->calls, 'push still delivered');
        $this->assertCount(0, $transport->messages(), 'email suppressed for the opted-out category');

        // A different category (platform) still emails normally.
        $notifier->toTenant($tenant->id, 'company_banned', ['company' => 'Acme'], '/admin/companies');

        $this->assertCount(1, $transport->messages(), 'other categories still email');
        $this->assertSame(
            'm@a.de',
            $transport->messages()[0]->getEnvelope()->getRecipients()[0]->getAddress(),
        );
    }

    public function test_admin_broadcast_always_delivers_email_even_when_broadcast_would_be_ignored(): void
    {
        $this->pushSpy();
        $transport = Mail::mailer()->getSymfonyTransport();

        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        // Opt out of everything we can — broadcast is not user-configurable.
        $manager = User::create([
            'name' => 'M',
            'email' => 'm@a.de',
            'password' => Hash::make('x'),
            'tenant_id' => $tenant->id,
            'locale' => 'en',
            'notification_prefs' => ['email' => ['platform' => false, 'subscription' => false]],
        ]);
        $manager->assignRole('fleet_manager');

        app(Notifier::class)->toUser($manager, 'admin_broadcast', ['title' => 'Hi', 'body' => 'Everyone']);

        $this->assertCount(1, $transport->messages(), 'broadcast ignores prefs and always emails');
    }

    public function test_get_returns_defaults_and_put_persists_prefs(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create([
            'name' => 'M',
            'email' => 'm@a.de',
            'password' => Hash::make('x'),
            'tenant_id' => $tenant->id,
        ]);
        $manager->assignRole('fleet_manager');

        $this->actingAs($manager)
            ->getJson('/api/v1/notification-prefs')
            ->assertOk()
            ->assertJsonPath('data.email.subscription', true)
            ->assertJsonPath('data.push.sessions', true);

        $this->actingAs($manager)
            ->putJson('/api/v1/notification-prefs', [
                'email' => ['subscription' => false],
                'push' => ['sessions' => false],
            ])
            ->assertOk()
            ->assertJsonPath('data.email.subscription', false)
            ->assertJsonPath('data.push.sessions', false)
            ->assertJsonPath('data.email.platform', true);

        $this->assertFalse($manager->fresh()->wantsChannel('email', 'subscription'));
        $this->assertFalse($manager->fresh()->wantsChannel('push', 'sessions'));
    }
}
