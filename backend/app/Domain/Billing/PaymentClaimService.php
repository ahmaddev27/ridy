<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Mail\PaymentClaimResolvedMail;
use App\Domain\Billing\Models\PaymentClaim;
use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Opens and resolves company payment claims ("I've paid" requests). Enforces at
 * most one PENDING claim per company so a company can't spam the admin list, and
 * emails the company when the admin confirms or rejects.
 */
class PaymentClaimService
{
    public const PENDING = 'pending';

    public const CONFIRMED = 'confirmed';

    public const REJECTED = 'rejected';

    public function __construct(private readonly Notifier $notifier) {}

    /**
     * Open a pending claim for the company, or return the one already pending
     * (idempotent). Race-safe: two concurrent submits yield a single claim. A
     * newly opened claim notifies the super-admins so they can verify it.
     *
     * @return array{claim: PaymentClaim, created: bool}
     */
    public function open(Tenant $tenant): array
    {
        $result = DB::transaction(function () use ($tenant) {
            $existing = PaymentClaim::where('tenant_id', $tenant->id)
                ->where('status', self::PENDING)
                ->lockForUpdate()
                ->first();

            if ($existing !== null) {
                return ['claim' => $existing, 'created' => false];
            }

            $claim = PaymentClaim::create([
                'tenant_id' => $tenant->id,
                'reference' => $tenant->ensurePaymentReference(),
                'status' => self::PENDING,
            ]);

            return ['claim' => $claim, 'created' => true];
        });

        // Notify admins only for a genuinely new claim (after the row is committed).
        if ($result['created']) {
            $this->notifier->toAdmins(
                'payment_claim',
                ['company' => $tenant->name, 'reference' => $result['claim']->reference],
                '/admin/payment-requests',
            );
        }

        return $result;
    }

    /** Whether the company currently has a pending claim (drives the button state). */
    public function hasPending(Tenant $tenant): bool
    {
        return PaymentClaim::where('tenant_id', $tenant->id)
            ->where('status', self::PENDING)
            ->exists();
    }

    /**
     * Confirm or reject a pending claim and email the company the outcome. A
     * rejection carries the admin's reason. The email is best-effort — a mail
     * failure never blocks resolving the claim.
     */
    public function resolve(PaymentClaim $claim, bool $confirmed, ?string $reason, User $admin, ?string $activationCode = null): PaymentClaim
    {
        $claim->forceFill([
            'status' => $confirmed ? self::CONFIRMED : self::REJECTED,
            'reason' => $reason,
            'resolved_at' => now(),
            'resolved_by' => $admin->id,
        ])->save();

        $this->emailOutcome($claim, $confirmed, $reason, $activationCode);

        return $claim;
    }

    private function emailOutcome(PaymentClaim $claim, bool $confirmed, ?string $reason, ?string $activationCode): void
    {
        try {
            $tenant = $claim->tenant;
            if ($tenant === null) {
                return;
            }

            $recipients = User::where('tenant_id', $tenant->id)
                ->whereNotNull('email')
                ->pluck('email')
                ->all();
            if ($recipients === []) {
                return;
            }

            Mail::to($recipients)->send(
                new PaymentClaimResolvedMail($tenant->name, $claim->reference, $confirmed, $reason, $activationCode)
            );
        } catch (Throwable $e) {
            Log::warning('payment_claim_email_failed', ['claim_id' => $claim->id, 'error' => $e->getMessage()]);
        }
    }
}
