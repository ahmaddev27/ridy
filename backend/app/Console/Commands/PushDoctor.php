<?php

namespace App\Console\Commands;

use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Notifications\Push\LogPushSender;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Console\Command;

/**
 * Readiness check for driver push. Answers "why are no notifications arriving":
 * either the bound sender is the LogPushSender (no FCM credentials on this
 * host, so nothing is ever sent for real), or there are simply no device
 * tokens registered for the drivers. Optionally fires a real test push.
 */
class PushDoctor extends Command
{
    protected $signature = 'push:doctor {--send= : Driver id to send a live test push to}';

    protected $description = 'Report push readiness: bound sender, FCM credentials, and device tokens.';

    public function handle(PushSender $sender): int
    {
        $senderClass = $sender::class;
        $isLog = $sender instanceof LogPushSender;

        $this->line('Bound sender: '.($isLog
            ? "<fg=red>{$senderClass}</> (pushes are only LOGGED, never delivered)"
            : "<fg=green>{$senderClass}</>"));

        $creds = (string) config('services.fcm.credentials');
        $credsOk = $creds !== '' && is_file($creds);
        $this->line('FCM_CREDENTIALS: '.($creds === ''
            ? '<fg=red>unset</>'
            : ($credsOk ? "<fg=green>{$creds}</>" : "<fg=red>{$creds} (file missing)</>")));
        $this->line('FCM_PROJECT_ID: '.((string) config('services.fcm.project_id') ?: '<fg=gray>(from credentials file)</>'));

        $total = DeviceToken::withoutGlobalScopes()->count();
        $this->newLine();
        $this->line("Device tokens registered: {$total}");

        $rows = Tenant::query()->orderBy('id')->get()->map(function (Tenant $t) {
            $tokens = DeviceToken::withoutGlobalScopes()->where('tenant_id', $t->id)->count();
            $drivers = DeviceToken::withoutGlobalScopes()->where('tenant_id', $t->id)->distinct('driver_id')->count('driver_id');

            return ["#{$t->id} ".mb_strimwidth((string) $t->name, 0, 22, '…'), (string) $tokens, (string) $drivers];
        })->all();
        $this->table(['Company', 'Tokens', 'Drivers w/ token'], $rows);

        if ($this->option('send') !== null) {
            $this->sendTest($sender, (int) $this->option('send'));
        }

        $this->newLine();
        if ($isLog) {
            $this->warn('No real delivery: set FCM_CREDENTIALS to a Google service-account JSON path (mounted into the backend container) and redeploy.');
        } elseif ($total === 0) {
            $this->warn('Sender is live but no device tokens exist — drivers must open the app, grant notification permission, and register (a production build with google-services.json, not Expo Go).');
        } else {
            $this->info('Push looks configured. Use --send=<driver_id> to fire a live test.');
        }

        return self::SUCCESS;
    }

    private function sendTest(PushSender $sender, int $driverId): void
    {
        $tokens = DeviceToken::withoutGlobalScopes()->where('driver_id', $driverId)->get();
        if ($tokens->isEmpty()) {
            $this->error("Driver #{$driverId} has no registered device tokens.");

            return;
        }

        foreach ($tokens as $token) {
            $ok = $sender->send($token->token, 'Reidey test', 'Test push from push:doctor', ['test' => '1']);
            $this->line("→ {$token->platform} ".substr($token->token, 0, 14).'… '.($ok ? '<fg=green>sent</>' : '<fg=red>failed (see logs)</>'));
        }
    }
}
