<?php

namespace App\Domain\Auth;

use App\Support\Settings;
use Illuminate\Support\Facades\Hash;

/**
 * A single app-store reviewer sign-in: ONE configured email may sign into the
 * driver app with ONE fixed 6-digit code instead of an emailed one, so Apple /
 * Google review can get past the passwordless OTP screen.
 *
 * Unlike the removed hard-coded review backdoor it is OFF unless an admin turns
 * it on (`php artisan app-review:login`), stores only a bcrypt hash of the code,
 * covers the driver-app sign-in only (never the dashboard or a password reset),
 * and every use is logged. Turn it off again once review is done.
 */
class ReviewLogin
{
    public const EMAIL_KEY = 'app_review_login_email';

    public const CODE_HASH_KEY = 'app_review_login_code_hash';

    public function enable(string $email, string $code): void
    {
        Settings::setMany([
            self::EMAIL_KEY => mb_strtolower(trim($email)),
            self::CODE_HASH_KEY => Hash::make($code),
        ]);
    }

    public function disable(): void
    {
        Settings::setMany([self::EMAIL_KEY => null, self::CODE_HASH_KEY => null]);
    }

    /** The configured reviewer email, or null when the review sign-in is off. */
    public function email(): ?string
    {
        $email = Settings::get(self::EMAIL_KEY);

        return $email !== null && Settings::get(self::CODE_HASH_KEY) !== null ? $email : null;
    }

    public function matches(string $email, string $code): bool
    {
        $configured = $this->email();

        // Compare the email first (exact, case-insensitive) so no other sign-in
        // ever pays the bcrypt cost or can be matched by the reviewer code.
        if ($configured === null || ! OtpGuard::sameEmail($configured, $email)) {
            return false;
        }

        return Hash::check($code, (string) Settings::get(self::CODE_HASH_KEY));
    }
}
