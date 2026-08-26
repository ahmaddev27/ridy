<?php

namespace App\Domain\Fleet;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\SendTemplatedMail;
use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Models\PasswordReset;
use App\Support\Settings;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Owns the driver app onboarding lifecycle: a manager invites a driver by email,
 * the driver signs in passwordlessly with an emailed one-time code, and is
 * activated on first success. Keeps the invitation rules in one place so the
 * controllers stay thin.
 */
class DriverInvitationService
{
    use GeneratesOtp;

    /** An unused invite link stops working after this — a leaked/old link can't be replayed. */
    public const INVITE_TTL_DAYS = 7;

    /** How long the emailed sign-in code stays valid. */
    private const OTP_TTL_MINUTES = 30;

    /**
     * Issue (or re-issue) an invitation: email a one-time sign-in code. Falls back
     * to the driver's Uber email (captured when they were linked) so a manager
     * doesn't have to type it; the chosen address becomes the driver's login email.
     * No password is involved — the code the driver enters is the credential.
     */
    public function invite(Driver $driver): void
    {
        $email = filled($driver->email) ? $driver->email : $driver->uber_email;

        if (blank($email)) {
            throw ValidationException::withMessages([
                'email' => [__('The driver has no email address (none on file and none from Uber).')],
            ]);
        }

        $driver->forceFill([
            'email' => $email, // remember the login address (may have come from Uber)
            'invite_token' => Str::random(48),
            'invited_at' => now(),
        ])->save();

        $reset = PasswordReset::updateOrCreate(
            ['email' => $email],
            [
                'otp' => $this->newOtp(),
                'otp_expires_at' => CarbonImmutable::now()->addMinutes(self::OTP_TTL_MINUTES),
                'attempts' => 0,
            ],
        );

        SendTemplatedMail::to($email, 'driver_invite', [
            'company_name' => (string) ($driver->tenant?->name ?? 'Reidey'),
            'driver_name' => (string) $driver->name,
            'otp' => $reset->otp,
            // Per-platform download links — the same admin-configured URLs the
            // in-app force-update dialog points at (an APK before the store, a
            // store link after). The email can't know the driver's device, so we
            // send both and let them pick. Empty until the admin sets them.
            'download_android' => (string) (Settings::get('app_android_store_url') ?? ''),
            'download_ios' => (string) (Settings::get('app_ios_store_url') ?? ''),
        ]);
    }

    /**
     * Resolve a pending invitation by its token. Returns null when the token is
     * unknown, already consumed, or the invite has expired ({@see INVITE_TTL_DAYS}).
     */
    public function findByToken(string $token): ?Driver
    {
        return Driver::withoutGlobalScopes()
            ->where('invite_token', $token)
            ->whereNull('activated_at')
            ->where('invited_at', '>=', now()->subDays(self::INVITE_TTL_DAYS))
            ->first();
    }

    /**
     * Complete activation: set the password, stamp activation, and consume the
     * token so the link cannot be reused.
     */
    public function activate(Driver $driver, string $password): void
    {
        $driver->forceFill([
            'password' => Hash::make($password),
            'activated_at' => now(),
            'invite_token' => null,
        ])->save();
    }

    private function activationLink(string $token): string
    {
        $base = rtrim((string) config('app.frontend_url', config('app.url')), '/');

        return $base.'/driver/activate?token='.$token;
    }
}
