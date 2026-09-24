<?php

namespace App\Domain\Auth;

use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Models\PasswordReset;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * The one place an emailed 6-digit code is issued, checked and spent — shared by
 * the driver-app sign-in, both password resets and company sign-up (it used to
 * be copy-pasted four times).
 *
 * Why it exists: the per-code attempt counter reset every time a new code was
 * requested, so "5 guesses per code" was really "5 guesses per re-issue" and a
 * rotating IP pool could grind any account. Wrong guesses are therefore also
 * counted per ACCOUNT in the rate limiter, which a re-issued code does not reset.
 *
 * Lock-out safety: only a real wrong guess against a live pending code counts (a
 * stranger who merely knows the address can't spend the owner's budget), the
 * tight budget is per account + client network, and the account-wide ceiling is
 * much higher and still lets the first guess on a freshly issued code through —
 * so the rightful owner, who receives that code, always has a way back in.
 *
 * Every key and check uses the email STORED on the pending row: MySQL's
 * accent-insensitive collation matches look-alike inputs ("gmäil") to the real
 * row, so the typed address must also equal the stored one exactly (ignoring
 * case) and never gets a budget of its own.
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

    /** Wrong guesses allowed per account from one client network… */
    public const MAX_FAILURES_PER_CLIENT = 5;

    /** …within this self-healing window (never a permanent lock). */
    public const FAILURE_WINDOW_SECONDS = 900;

    /** Wrong guesses allowed per account from ALL clients (rotating-IP backstop)… */
    public const MAX_FAILURES_PER_EMAIL = 30;

    /** …within this window. */
    public const EMAIL_FAILURE_WINDOW_SECONDS = 3600;

    /** Issue (or rotate) the password_resets code for an email; returns the row. */
    public function issueReset(string $email, int $ttlMinutes): PasswordReset
    {
        $reset = PasswordReset::updateOrCreate(
            ['email' => $email],
            [
                'otp' => $this->newOtp(),
                'otp_expires_at' => CarbonImmutable::now()->addMinutes($ttlMinutes),
                'attempts' => 0,
            ],
        );
        $this->unlockClient($reset->email);

        return $reset;
    }

    /** A fresh code for callers that store it themselves (company sign-up). */
    public function newCode(): string
    {
        return $this->newOtp();
    }

    /**
     * A new code was just emailed at this client's request: lift ITS per-client
     * lock, so a user locked out by someone else's guessing can get back in by
     * asking for a new code. The account-wide ceiling is untouched.
     */
    public function unlockClient(string $email): void
    {
        RateLimiter::clear(self::clientFailureKey($email, $this->clientKey()));
    }

    /** Check a code against the password_resets row for this email. */
    public function verifyReset(string $email, string $code): PasswordReset
    {
        /** @var PasswordReset */
        return $this->verify(PasswordReset::where('email', $email)->first(), $email, $code);
    }

    /**
     * Check a code against a pending row (password_resets / registrations shape:
     * email, otp, otp_expires_at, attempts). Throws the coded ValidationException
     * the clients localize; returns the row on success.
     *
     * @template TModel of Model
     *
     * @param  TModel|null  $pending
     * @return TModel
     */
    public function verify(?Model $pending, string $email, string $code): Model
    {
        // No pending code, or a look-alike of the stored address: nothing to guess
        // against, so nothing is counted either.
        if ($pending === null || ! self::sameEmail((string) $pending->email, $email)) {
            throw ValidationException::withMessages(['otp' => 'otp_incorrect']);
        }
        if ($pending->otp_expires_at->isPast()) {
            throw ValidationException::withMessages(['otp' => 'otp_expired']);
        }

        $clientKey = self::clientFailureKey((string) $pending->email, $this->clientKey());
        $emailKey = self::failureKey((string) $pending->email);
        if ($this->locked($pending, $clientKey, $emailKey)) {
            throw ValidationException::withMessages(['otp' => 'otp_too_many']);
        }

        // Spend the attempt BEFORE comparing, atomically and only while under the
        // cap, so N parallel guesses can never exceed MAX_ATTEMPTS on one code.
        $spent = $pending->newQuery()
            ->whereKey($pending->getKey())
            ->where('attempts', '<', self::MAX_ATTEMPTS)
            ->increment('attempts');
        if ($spent === 0) {
            throw ValidationException::withMessages(['otp' => 'otp_too_many']);
        }

        if (! hash_equals((string) $pending->otp, $code) && ! $this->isTestCode($code)) {
            RateLimiter::hit($clientKey, self::FAILURE_WINDOW_SECONDS);
            RateLimiter::hit($emailKey, self::EMAIL_FAILURE_WINDOW_SECONDS);
            throw ValidationException::withMessages(['otp' => 'otp_incorrect']);
        }

        // A correct code is not a failure: give the attempt back (the reset flow
        // verifies twice) and don't let it eat the user's budget.
        $pending->newQuery()->whereKey($pending->getKey())->where('attempts', '>', 0)->decrement('attempts');
        RateLimiter::clear($clientKey);
        RateLimiter::clear($emailKey);

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

    /**
     * Exact (case-insensitive) address equality — stricter than the database's
     * accent-insensitive collation, which treats "gmäil.com" as "gmail.com".
     */
    public static function sameEmail(string $stored, string $typed): bool
    {
        return mb_strtolower(trim($stored)) === mb_strtolower(trim($typed));
    }

    /** The rate-limiter key counting one account's wrong guesses from every client. */
    public static function failureKey(string $email): string
    {
        return 'otp-fail:'.sha1(mb_strtolower(trim($email)));
    }

    /** The rate-limiter key counting one account's wrong guesses from one client network. */
    public static function clientFailureKey(string $email, string $client): string
    {
        return self::failureKey($email).':'.sha1($client);
    }

    /**
     * Locked when this client used up its budget, or when the whole account did —
     * except for the first guess on a freshly issued code, which the account-wide
     * ceiling never blocks (that code went to the owner's inbox; brute force stays
     * bounded by how often a code may be issued).
     */
    private function locked(Model $pending, string $clientKey, string $emailKey): bool
    {
        if (RateLimiter::tooManyAttempts($clientKey, self::MAX_FAILURES_PER_CLIENT)) {
            return true;
        }

        return (int) $pending->attempts > 0
            && RateLimiter::tooManyAttempts($emailKey, self::MAX_FAILURES_PER_EMAIL);
    }

    private function clientKey(): string
    {
        return AuthRateLimits::clientKey(app(Request::class));
    }
}
