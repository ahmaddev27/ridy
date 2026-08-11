<?php

namespace App\Http\Controllers\Concerns;

trait GeneratesOtp
{
    /** A zero-padded 6-digit numeric one-time password. */
    protected function newOtp(): string
    {
        // An explicit fixed code (OTP_TEST_CODE) wins in ANY environment — set it
        // on a staging/demo server to test without an inbox. Outside production we
        // also default to 111111 for local development.
        $fixed = config('services.otp_test_code');
        if (filled($fixed)) {
            return (string) $fixed;
        }
        if (! app()->isProduction()) {
            return '111111';
        }

        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    /** Whether the given input is the configured test code (accepted anywhere). */
    protected function isTestCode(string $input): bool
    {
        $fixed = config('services.otp_test_code');

        return filled($fixed) && hash_equals((string) $fixed, $input);
    }
}
