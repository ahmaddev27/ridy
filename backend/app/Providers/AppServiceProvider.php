<?php

namespace App\Providers;

use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Push\FcmPushSender;
use App\Domain\Notifications\Push\GoogleServiceAccountToken;
use App\Domain\Notifications\Push\LogPushSender;
use App\Domain\Tenancy\TenantContext;
use App\Support\Settings;
use Illuminate\Support\Facades\Queue;
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
        // Real FCM when a service-account credentials file is present, otherwise
        // log the push so the full flow works without a Firebase project.
        $this->app->bind(PushSender::class, function () {
            $credentials = (string) config('services.fcm.credentials');
            if ($credentials === '' || ! is_file($credentials)) {
                return new LogPushSender;
            }

            $auth = new GoogleServiceAccountToken($credentials);
            $projectId = (string) config('services.fcm.project_id') ?: $auth->credentials()['project_id'];

            return new FcmPushSender($auth, $projectId);
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->applyMailSettings();

        // Clear any lingering tenant context before each queued job runs, so a
        // long-lived worker never inherits the previous job's tenant scope. Each
        // job that needs a tenant sets its own (or queries withoutGlobalScopes).
        Queue::looping(function () {
            $this->app->make(TenantContext::class)->forget();
        });
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
