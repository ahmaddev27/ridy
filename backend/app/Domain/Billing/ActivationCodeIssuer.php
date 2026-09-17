<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Concerns\GeneratesOtp;
use Carbon\CarbonImmutable;

/**
 * Issues a plan-based activation code for a company: sets the tenant's activation
 * fields (the code the owner will enter), writes the SubscriptionCode ledger row,
 * and assigns its payment reference. Shared by the admin "generate code" action
 * and the "accept payment claim" flow so both mint codes identically.
 */
class ActivationCodeIssuer
{
    use GeneratesOtp;

    private const CODE_TTL_MINUTES = 10;

    public function __construct(private readonly PaymentReferenceGenerator $paymentRefs) {}

    /**
     * @return array{code: string, payment_ref: string, expires_at: CarbonImmutable}
     */
    public function issue(
        Tenant $tenant,
        Plan $plan,
        bool $paid,
        ?string $paymentMethod,
        ?int $collectorId,
        ?int $createdBy,
    ): array {
        $code = $this->newOtp();
        $expiresAt = CarbonImmutable::now()->addMinutes(self::CODE_TTL_MINUTES);

        $tenant->forceFill([
            'activation_code' => $code,
            'activation_code_expires_at' => $expiresAt,
            'activation_days' => $plan->duration_days,
            'activation_amount' => $plan->price,
            'activation_paid' => $paid,
            'activation_collector_id' => $collectorId,
            'activation_attempts' => 0,
        ])->save();

        $ledger = SubscriptionCode::create([
            'code' => $code,
            'plan_id' => $plan->id,
            'tenant_id' => $tenant->id,
            'collector_id' => $collectorId,
            'amount' => $plan->price,
            'paid' => $paid,
            'payment_method' => $paymentMethod,
            'expires_at' => $expiresAt,
            'created_by' => $createdBy,
        ]);

        $paymentRef = $this->paymentRefs->assign($ledger, $tenant, (int) CarbonImmutable::now()->format('Y'));

        return ['code' => $code, 'payment_ref' => $paymentRef, 'expires_at' => $expiresAt];
    }
}
