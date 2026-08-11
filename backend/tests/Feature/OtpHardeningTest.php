<?php

namespace Tests\Feature;

use App\Http\Controllers\Concerns\GeneratesOtp;
use Tests\TestCase;

class OtpHardeningTest extends TestCase
{
    /** Exposes the trait's protected helpers for testing. */
    private function otp(): object
    {
        return new class
        {
            use GeneratesOtp;

            public function make(): string
            {
                return $this->newOtp();
            }

            public function check(string $code): bool
            {
                return $this->isTestCode($code);
            }
        };
    }

    public function test_non_production_uses_the_fixed_test_code(): void
    {
        config()->set('services.otp_test_code', '424242');

        $otp = $this->otp();
        $this->assertSame('424242', $otp->make());
        $this->assertTrue($otp->check('424242'));
    }

    public function test_production_ignores_the_test_code_and_issues_a_random_one(): void
    {
        config()->set('services.otp_test_code', '424242');
        $this->app->detectEnvironment(fn () => 'production');

        $otp = $this->otp();

        // The fixed code is never a valid backdoor in production.
        $this->assertFalse($otp->check('424242'));
        // And a real 6-digit code is issued instead.
        $this->assertMatchesRegularExpression('/^\d{6}$/', $otp->make());
    }
}
