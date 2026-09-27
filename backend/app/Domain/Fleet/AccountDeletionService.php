<?php

namespace App\Domain\Fleet;

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Models\DeviceToken;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Request;
use Throwable;

/**
 * In-app account deletion REQUEST (App Store 5.1.1(v), Google Play account
 * deletion policy, DSGVO Art. 17).
 *
 * Takes effect for the app immediately — every session is revoked and every
 * push device removed, so the phone stops receiving offers — and records an
 * audit entry the platform admin works from to erase the personal data within
 * 30 days. The roster record itself stays the fleet's decision (offers keep
 * their driver id), so nothing operational is destroyed from a phone.
 */
class AccountDeletionService
{
    public const ACTION = 'account.deletion_requested';

    public function requestForDriver(Driver $driver): void
    {
        DB::transaction(function () use ($driver): void {
            DeviceToken::withoutGlobalScopes()->where('driver_id', $driver->id)->delete();
            $driver->tokens()->delete();
            $this->audit($driver, $driver->tenant_id, 'driver');
        });

        $this->notifyOps('driver', $driver->id, $driver->tenant_id);
    }

    /**
     * A fleet owner/manager asking from the app. Only their MOBILE sessions and
     * devices are revoked — dashboard access of a company account is handled by
     * the platform admin with the company, never cut off from a phone.
     */
    public function requestForOwner(User $user, string $appTokenName): void
    {
        DB::transaction(function () use ($user, $appTokenName): void {
            DeviceToken::withoutGlobalScopes()->where('user_id', $user->id)->delete();
            $user->tokens()->where('name', $appTokenName)->delete();
            $this->audit($user, $user->tenant_id, 'owner');
        });

        $this->notifyOps('owner', $user->id, $user->tenant_id);
    }

    private function audit(Model $subject, ?int $tenantId, string $account): void
    {
        AuditLog::create([
            'tenant_id' => $tenantId,
            'actor_id' => null, // the subject itself (drivers are not users)
            'action' => self::ACTION,
            'subject_type' => $subject::class,
            'subject_id' => $subject->getKey(),
            'context' => ['account' => $account, 'source' => 'driver_app'],
            'ip' => Request::ip(),
            'created_at' => now(),
        ]);
    }

    /** Tell the platform admin there is an erasure to carry out (ids only, no PII). */
    private function notifyOps(string $account, int $id, ?int $tenantId): void
    {
        Log::info('account.deletion_requested', ['account' => $account, 'id' => $id, 'tenant_id' => $tenantId]);

        $to = config('services.alerts.email');
        if (empty($to)) {
            return;
        }

        try {
            Mail::raw(
                "An account deletion was requested from the driver app.\n\n"
                ."Account type: {$account}\nAccount id: {$id}\nCompany id: ".($tenantId ?? '-')."\n\n"
                .'Erase the personal data within 30 days (DSGVO Art. 17). See the audit log entry "'.self::ACTION.'".',
                fn ($mail) => $mail->to($to)->subject('[Reidey Ops] Account deletion requested'),
            );
        } catch (Throwable) {
            // Mail is best-effort; the audit entry is the record.
        }
    }
}
