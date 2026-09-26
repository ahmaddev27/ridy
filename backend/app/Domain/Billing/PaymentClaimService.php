<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Mail\PaymentClaimResolvedMail;
use App\Domain\Billing\Models\PaymentClaim;
use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
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
     * (idempotent). Race-safe: concurrent submits queue on a primary-key lock of
     * the tenant row, so the second one sees the first one's claim. (Locking the
     * empty pending-claim range instead took gap locks that deadlocked under
     * InnoDB and 500'd the loser.) A newly opened claim notifies the super-admins.
     *
     * @return array{claim: PaymentClaim, created: bool}
     */
    public function open(Tenant $tenant): array
    {
        $result = DB::transaction(function () use ($tenant) {
            Tenant::query()->whereKey($tenant->id)->lockForUpdate()->first();

            $existing = PaymentClaim::where('tenant_id', $tenant->id)
                ->where('status', self::PENDING)
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
     * rejection carries the admin's reason.
     *
     * The claim is taken with a conditional update (pending → resolved), so of two
     * concurrent confirms (two admins, a double-click) exactly one wins; the loser
     * gets `claim_already_resolved` and issues nothing. `$issueCode` (confirm only)
     * runs in the same transaction, so a failed issue leaves the claim pending.
     * The email is best-effort and sent only after the commit.
     *
     * @param  (Closure(): string)|null  $issueCode  mints the activation code to email
     *
     * @throws ValidationException claim_already_resolved
     */
    public function resolve(PaymentClaim $claim, bool $confirmed, ?string $reason, User $admin, ?Closure $issueCode = null): PaymentClaim
    {
        $activationCode = DB::transaction(function () use ($claim, $confirmed, $reason, $admin, $issueCode) {
            $won = PaymentClaim::whereKey($claim->id)
                ->where('status', self::PENDING)
                ->update([
                    'status' => $confirmed ? self::CONFIRMED : self::REJECTED,
                    'reason' => $reason,
                    'resolved_at' => now(),
                    'resolved_by' => $admin->id,
                ]);
            if ($won === 0) {
                throw ValidationException::withMessages(['status' => 'claim_already_resolved']);
            }

            return $confirmed && $issueCode !== null ? $issueCode() : null;
        });

        $claim->refresh();
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
