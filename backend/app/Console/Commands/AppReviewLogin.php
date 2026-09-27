<?php

namespace App\Console\Commands;

use App\Domain\Auth\ReviewLogin;
use Illuminate\Console\Command;

/**
 * Turn the app-store reviewer sign-in on or off (see {@see ReviewLogin}).
 *
 *   php artisan app-review:login reviewer@example.com 123456   # on
 *   php artisan app-review:login --off                         # off
 *   php artisan app-review:login                               # status
 */
class AppReviewLogin extends Command
{
    protected $signature = 'app-review:login {email? : the reviewer account email} {code? : fixed 6-digit code} {--off : turn the reviewer sign-in off}';

    protected $description = 'Enable/disable the fixed-code driver-app sign-in for App Store / Play review.';

    public function handle(ReviewLogin $review): int
    {
        if ($this->option('off')) {
            $review->disable();
            $this->info('Reviewer sign-in is OFF.');

            return self::SUCCESS;
        }

        $email = $this->argument('email');
        $code = $this->argument('code');

        if ($email === null) {
            $current = $review->email();
            $this->line($current === null ? 'Reviewer sign-in is OFF.' : "Reviewer sign-in is ON for {$current}.");

            return self::SUCCESS;
        }

        if (! filter_var($email, FILTER_VALIDATE_EMAIL) || ! preg_match('/^\d{6}$/', (string) $code)) {
            $this->error('Usage: app-review:login <email> <6-digit code>');

            return self::FAILURE;
        }

        $review->enable($email, (string) $code);
        $this->info("Reviewer sign-in is ON for {$email}. The account must exist as a driver or fleet owner. Turn it off after review: app-review:login --off");

        return self::SUCCESS;
    }
}
