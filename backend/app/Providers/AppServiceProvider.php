<?php

namespace App\Providers;

use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Push\FcmPushSender;
use App\Domain\Notifications\Push\LogPushSender;
use App\Support\Settings;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\ServiceProvider;
use Throwable;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Real FCM when a server key is configured, otherwise log the push so the
        // full flow works without a Firebase project.
        $this->app->bind(PushSender::class, function () {
            $key = (string) config('services.fcm.server_key');

            return $key !== ''
                ? new FcmPushSender((string) config('services.fcm.endpoint'), $key)
                : new LogPushSender;
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->applyMailSettings();
    }

    /**
     * Live SMTP config: the super-admin edits mail settings in the DB and they
     * take effect without touching the server. Wrapped defensively so a missing
     * settings table (e.g. before migrate) never breaks booting.
     */
    private function applyMailSettings(): void
    {
        try {
            if (! Schema::hasTable('settings')) {
                return;
            }

            $from = [
                'mail.from.address' => Settings::get('mail_from_address', config('mail.from.address')),
                'mail.from.name' => Settings::get('mail_from_name', config('mail.from.name')),
            ];

            // The super-admin picks the provider: Resend (API key) or SMTP.
            $provider = Settings::get('mail_provider', 'smtp');
            $resendKey = Settings::get('resend_api_key');

            if ($provider === 'resend' && $resendKey) {
                config(array_merge($from, [
                    'mail.default' => 'resend',
                    'services.resend.key' => $resendKey,
                ]));

                return;
            }

            $host = Settings::get('smtp_host');
            if (! $host) {
                return; // not configured — keep the .env / log mailer
            }

            config(array_merge($from, [
                'mail.default' => 'smtp',
                'mail.mailers.smtp.host' => $host,
                'mail.mailers.smtp.port' => (int) Settings::get('smtp_port', '587'),
                'mail.mailers.smtp.username' => Settings::get('smtp_username'),
                'mail.mailers.smtp.password' => Settings::get('smtp_password'),
                'mail.mailers.smtp.encryption' => Settings::get('smtp_encryption', 'tls'),
            ]));
        } catch (Throwable $e) {
            // never let settings break the app boot
        }
    }
}
