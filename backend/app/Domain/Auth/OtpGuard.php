<?php

namespace App\Domain\Auth;

use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Models\PasswordReset;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * The one place an emailed 6-digit code is issued, checked and spent — shared by
 * the driver-app sign-in, both password resets and company sign-up (it used to
 * be copy-pasted four times).
 *
 * Why it exists: the per-code attempt counter reset every time a new code was
 * requested, so "5 guesses per code" was really "5 guesses per re-issue" and a
 * rotating IP pool could grind any account. Wrong guesses are now also counted
 * per EMAIL in the rate limiter, which a re-issued code does not reset, and the
 * attempt is spent before the comparison so parallel guesses can't slip past.
 *
 * Error codes stay the ones the dashboard and app already translate. A missing
 * pending code answers `otp_incorrect` (not `otp_none`) so verify can't be used
 * to learn whether an email has an account.
 */
class OtpGuard
{
    use GeneratesOtp;

    /** Wrong guesses allowed on one issued code. */
    public const MAX_ATTEMPTS = 5;

    /** Wrong guesses allowed per email across every re-issued code… */
    public const MAX_FAILURES_PER_EMAIL = 5;

    /** …within this self-healing window (never a permanent lock). */
    public const FAILURE_WINDOW_SECONDS = 900;

    /** Issue (or rotate) the password_resets code for an email; returns the row. */
    public function issueReset(string $email, int $ttlMinutes): PasswordReset
    {
        return PasswordReset::updateOrCreate(
            ['email' => $email],
            [
                'otp' => $this->newOtp(),
                'otp_expires_at' => CarbonImmutable::now()->addMinutes($ttlMinutes),
                'attempts' => 0,
            ],
        );
    }

    /** A fresh code for callers that store it themselves (company sign-up). */
    public function newCode(): string
    {
        return $this->newOtp();
    }

    /** Check a code against the password_resets row for this email. */
    public function verifyReset(string $email, string $code): PasswordReset
    {
        /** @var PasswordReset */
        return $this->verify(PasswordReset::where('email', $email)->first(), $email, $code);
    }

    /**
     * Check a code against a pending row (password_resets / registrations shape:
     * otp, otp_expires_at, attempts). Throws the coded ValidationException the
     * clients localize; returns the row on success.
     *
     * @template TModel of Model
     *
     * @param  TModel|null  $pending
     * @return TModel
     */
    public function verify(?Model $pending, string $email, string $code): Model
    {
        $key = self::failureKey($email);

        // Spend the attempt first: the increment is atomic, so N parallel guesses
        // count as N — a read-then-increment let them all pass the check.
        if (RateLimiter::hit($key, self::FAILURE_WINDOW_SECONDS) > self::MAX_FAILURES_PER_EMAIL) {
            throw ValidationException::withMessages(['otp' => 'otp_too_many']);
        }

        if ($pending === null) {
            throw ValidationException::withMessages(['otp' => 'otp_incorrect']);
        }
        if ($pending->otp_expires_at->isPast()) {
            throw ValidationException::withMessages(['otp' => 'otp_expired']);
        }
        if ($pending->attempts >= self::MAX_ATTEMPTS) {
            throw ValidationException::withMessages(['otp' => 'otp_too_many']);
        }
        if (! hash_equals((string) $pending->otp, $code) && ! $this->isTestCode($code)) {
            $pending->increment('attempts');
            throw ValidationException::withMessages(['otp' => 'otp_incorrect']);
        }

        // A correct code is not a failure — don't let it eat the user's budget.
        RateLimiter::clear($key);

        return $pending;
    }

    /**
     * Spend a verified code exactly once (conditional delete), BEFORE minting a
     * token / changing a password — two concurrent correct submits used to both
     * succeed. Throws `otp_incorrect` for the loser.
     */
    public function consume(Model $pending): void
    {
        $deleted = $pending->newQuery()
            ->whereKey($pending->getKey())
            ->where('otp', $pending->otp)
            ->delete();

        if ($deleted !== 1) {
            throw ValidationException::withMessages(['otp' => 'otp_incorrect']);
        }
    }

    /** The rate-limiter key counting one email's wrong guesses (case-insensitive). */
    public static function failureKey(string $email): string
    {
        return 'otp-fail:'.sha1(mb_strtolower(trim($email)));
    }
}
