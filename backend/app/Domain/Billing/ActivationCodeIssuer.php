<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Concerns\GeneratesOtp;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Issues a plan-based activation code for a company: sets the tenant's activation
 * fields (the code the owner will enter), writes the SubscriptionCode ledger row,
 * and assigns its payment reference. Shared by the admin "generate code" action,
 * the "accept payment claim" flow and the reseller surface so all mint codes
 * identically.
 */
class ActivationCodeIssuer
{
    use GeneratesOtp;

    private const CODE_TTL_MINUTES = 60;

    public function __construct(private readonly PaymentReferenceGenerator $paymentRefs) {}

    /**
     * Mint a code into the tenant's single code slot. Runs under a lock on the
     * tenant row so two concurrent issuers can't both pass the guard below and
     * silently overwrite each other.
     *
     * With `$protectForeignPending` (the reseller path) a still-valid, unused code
     * minted by a DIFFERENT issuer is never clobbered — that would hijack the
     * activation's attribution and the reseller's commission. The same issuer may
     * freely regenerate; expired or used codes are fair to overwrite.
     *
     * @return array{code: string, payment_ref: string, expires_at: CarbonImmutable}
     *
     * @throws ValidationException code_pending_other_issuer
     */
    public function issue(
        Tenant $tenant,
        Plan $plan,
        bool $paid,
        ?string $paymentMethod,
        ?int $collectorId,
        ?int $createdBy,
        bool $protectForeignPending = false,
    ): array {
        return DB::transaction(function () use ($tenant, $plan, $paid, $paymentMethod, $collectorId, $createdBy, $protectForeignPending) {
            $locked = Tenant::query()->whereKey($tenant->id)->lockForUpdate()->firstOrFail();

            if ($protectForeignPending && $this->hasPendingForeignCode($locked, $collectorId)) {
                throw ValidationException::withMessages(['tenant_id' => 'code_pending_other_issuer']);
            }

            $code = $this->newOtp();
            $expiresAt = CarbonImmutable::now()->addMinutes(self::CODE_TTL_MINUTES);

            $locked->forceFill([
                'activation_code' => $code,
                'activation_code_expires_at' => $expiresAt,
                'activation_days' => $plan->duration_days,
                'activation_amount' => $plan->price,
                'activation_paid' => $paid,
                'activation_collector_id' => $collectorId,
                'activation_attempts' => 0,
            ])->save();
            $tenant->setRawAttributes($locked->getAttributes(), true);

            $ledger = SubscriptionCode::create([
                'code' => $code,
                'plan_id' => $plan->id,
                'tenant_id' => $locked->id,
                'collector_id' => $collectorId,
                'amount' => $plan->price,
                'paid' => $paid,
                'payment_method' => $paymentMethod,
                'expires_at' => $expiresAt,
                'created_by' => $createdBy,
            ]);

            $paymentRef = $this->paymentRefs->assign($ledger, $locked, (int) CarbonImmutable::now()->format('Y'));

            return ['code' => $code, 'payment_ref' => $paymentRef, 'expires_at' => $expiresAt];
        });
    }

    /** A still-valid, unused code minted by a different issuer than `$collectorId`. */
    private function hasPendingForeignCode(Tenant $tenant, ?int $collectorId): bool
    {
        return $tenant->activation_code !== null
            && ! ($tenant->activation_code_expires_at?->isPast() ?? true)
            && $tenant->activation_collector_id !== $collectorId;
    }
}
