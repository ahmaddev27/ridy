<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Support\Facades\Log;

trait GeneratesOtp
{
    /** A zero-padded 6-digit numeric one-time password. */
    protected function newOtp(): string
    {
        // Production ALWAYS gets a real random code — a fixed test code is never
        // honoured there, even if OTP_TEST_CODE leaked into the prod environment,
        // so it can never become a universal backdoor.
        if (app()->isProduction()) {
            // A real code is useless if it can't be delivered: the "log" mailer
            // writes it to the log instead of emailing it, locking users out.
            // Surface that misconfiguration loudly instead of failing silently.
            if (config('mail.default') === 'log') {
                Log::critical('OTP generated in production but MAIL is set to "log" — codes are not being delivered. Configure SMTP or Resend.');
            }

            return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        }

        // Non-production only: a fixed code for testing without an inbox
        // (OTP_TEST_CODE), defaulting to 111111 for local development.
        $fixed = config('services.otp_test_code');

        return filled($fixed) ? (string) $fixed : '111111';
    }

    /** Whether the input is the configured test code — accepted outside production only. */
    protected function isTestCode(string $input): bool
    {
        if (app()->isProduction()) {
            return false;
        }

        $fixed = config('services.otp_test_code');

        return filled($fixed) && hash_equals((string) $fixed, $input);
    }
}
