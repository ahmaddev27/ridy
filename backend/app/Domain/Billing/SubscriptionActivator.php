<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Mail\InvoiceMail;
use App\Domain\Billing\Models\InvoiceSettings;
use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\ProxyPool;
use App\Models\User;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Applies a validated subscription (from an activation code) to a tenant. Shared
 * by the public first-time/renew activation and the in-dashboard "redeem code"
 * flow so both behave identically.
 *
 * Renewals **stack**: if the tenant still has time left, the new period starts
 * when the current one ends (not now), so redeeming early never loses days.
 *
 * Redemption is atomic: the tenant row is locked, the code re-checked against the
 * locked row, and the period + invoice number + ledger link written in one
 * transaction — so N parallel requests with one code yield exactly one period.
 * Side effects (proxy, email, notifications) run only after the commit.
 */
class SubscriptionActivator
{
    /**
     * The latest end a subscription may stack to. `subscription_ends_at` and the
     * period columns are MySQL TIMESTAMP (max 2038-01-19), so a later value would
     * be rejected by strict mode mid-activation.
     */
    public const MAX_ENDS_AT = '2037-12-31 00:00:00';

    public function __construct(
        private Notifier $notifier,
        private ProxyPool $proxies,
        private InvoiceNumberGenerator $invoiceNumbers,
        private InvoiceRenderer $invoices,
    ) {}

    /**
     * Grant `$days` to the tenant, stacking after any remaining time, record the
     * period, close the code's ledger entry, ensure a proxy, and notify. When a
     * `$usedCode` is given it must still be the tenant's pending code under the
     * row lock (a parallel request that already consumed it makes this one fail
     * with `otp_incorrect`). Returns the created period.
     */
    public function apply(
        Tenant $tenant,
        int $days,
        float|string|null $amount,
        bool $paid,
        ?int $soldBy,
        ?string $usedCode,
    ): SubscriptionPeriod {
        return $this->grant(
            $tenant,
            $usedCode,
            $usedCode !== null,
            fn () => [$days, $amount, $paid, $soldBy],
        );
    }

    /**
     * Redeem the tenant's pending admin/reseller-issued code. The plan terms are
     * read from the LOCKED tenant row, never from a copy loaded before the lock.
     */
    public function redeemIssuedCode(Tenant $tenant, string $code): SubscriptionPeriod
    {
        return $this->grant($tenant, $code, true, fn (Tenant $locked) => [
            (int) $locked->activation_days,
            $locked->activation_amount,
            (bool) $locked->activation_paid,
            $locked->activation_collector_id,
        ]);
    }

    /** Whether `$code` is the tenant's pending, unexpired activation code. */
    public function isPendingCode(Tenant $tenant, string $code): bool
    {
        return $tenant->activation_code !== null
            && ! ($tenant->activation_code_expires_at?->isPast() ?? false)
            && hash_equals((string) $tenant->activation_code, $code);
    }

    /**
     * Redeem the test code as a real monthly subscription: resolve the monthly
     * plan, write a matching ledger entry (so the history row shows the plan and
     * an "activated" status like a genuine purchase), then apply it — stacking
     * after any remaining time. Returns the created period. Callers must only
     * reach this for a production-guarded test code (GeneratesOtp::isTestCode).
     */
    public function applyTestMonthly(Tenant $tenant, string $code, ?int $createdBy): SubscriptionPeriod
    {
        $plan = $this->monthlyPlan();
        $days = $plan?->duration_days ?? 30;
        $amount = $plan?->price;

        return DB::transaction(function () use ($tenant, $code, $createdBy, $plan, $days, $amount) {
            // A ledger row the grant then marks activated and links to the period,
            // so the Subscription page shows the plan, amount and status.
            SubscriptionCode::create([
                'code' => $code,
                'plan_id' => $plan?->id,
                'tenant_id' => $tenant->id,
                'collector_id' => null,
                'amount' => $amount,
                'paid' => true,
                'expires_at' => CarbonImmutable::now()->addMinutes(10),
                'created_by' => $createdBy,
            ]);

            return $this->grant($tenant, $code, false, fn () => [$days, $amount, true, null]);
        });
    }

    /** Refuse an end date past the TIMESTAMP ceiling (see {@see MAX_ENDS_AT}). */
    public static function assertWithinMaxEnd(CarbonImmutable $endsAt, string $field = 'code'): void
    {
        if ($endsAt->greaterThan(CarbonImmutable::parse(self::MAX_ENDS_AT))) {
            throw ValidationException::withMessages([$field => 'subscription_too_long']);
        }
    }

    /**
     * @param  Closure(Tenant): array{0: int, 1: float|string|null, 2: bool, 3: ?int}  $terms
     */
    private function grant(Tenant $tenant, ?string $usedCode, bool $requirePendingCode, Closure $terms): SubscriptionPeriod
    {
        [$period, $ledgerEntry, $settings, $days, $amount, $paid] = DB::transaction(
            function () use ($tenant, $usedCode, $requirePendingCode, $terms) {
                $locked = Tenant::query()->whereKey($tenant->id)->lockForUpdate()->firstOrFail();

                // An admin-disabled company stays disabled: a code must never
                // silently re-enable it (only the admin can, via the company edit).
                if ($locked->status !== 'active') {
                    throw ValidationException::withMessages(['code' => 'account_disabled']);
                }
                if ($requirePendingCode && ! $this->isPendingCode($locked, (string) $usedCode)) {
                    throw ValidationException::withMessages(['code' => 'otp_incorrect']);
                }

                [$days, $amount, $paid, $soldBy] = $terms($locked);
                $days = max(1, $days);

                $now = CarbonImmutable::now();
                $current = $locked->subscription_ends_at ? CarbonImmutable::parse($locked->subscription_ends_at) : null;
                $startsAt = ($current && $current->isFuture()) ? $current : $now;
                $endsAt = $startsAt->addDays($days);
                self::assertWithinMaxEnd($endsAt);

                $locked->forceFill([
                    'banned_at' => null,
                    'activated_at' => $locked->activated_at ?? $now,
                    'subscription_ends_at' => $endsAt,
                    'activation_code' => null,
                    'activation_code_expires_at' => null,
                    'activation_days' => null,
                    'activation_amount' => null,
                    'activation_paid' => false,
                    'activation_collector_id' => null,
                    'activation_attempts' => 0,
                ])->save();

                $period = SubscriptionPeriod::create([
                    'tenant_id' => $locked->id,
                    'days' => $days,
                    'amount' => $amount,
                    'paid_at' => $paid ? $now : null,
                    'sold_by_collector_id' => $soldBy,
                    'starts_at' => $startsAt,
                    'ends_at' => $endsAt,
                ]);

                $ledgerEntry = $usedCode === null ? null : SubscriptionCode::where('tenant_id', $locked->id)
                    ->where('code', $usedCode)
                    ->whereNull('activated_at')
                    ->latest('id')
                    ->lockForUpdate()
                    ->first();
                $ledgerEntry?->forceFill([
                    'activated_at' => $now,
                    'subscription_period_id' => $period->id,
                ])->save();

                // Number the invoice by its ISSUE year (not the stacked start) and
                // freeze what it printed, in the same transaction as the period.
                $settings = InvoiceSettings::current();
                $this->invoiceNumbers->assign($period, $settings->number_prefix, (int) $now->format('Y'));
                $this->invoices->snapshot($period, $settings, $locked, $now);

                $tenant->setRawAttributes($locked->getAttributes(), true);

                return [$period->fresh(), $ledgerEntry, $settings, $days, $amount, $paid];
            }
        );

        DB::afterCommit(fn () => $this->afterGrant($tenant, $period, $ledgerEntry, $settings, $days, $amount, $paid, $usedCode));

        return $period;
    }

    /** Proxy, invoice email and notifications — only once the grant is committed. */
    private function afterGrant(
        Tenant $tenant,
        SubscriptionPeriod $period,
        ?SubscriptionCode $ledgerEntry,
        InvoiceSettings $settings,
        int $days,
        float|string|null $amount,
        bool $paid,
        ?string $usedCode,
    ): void {
        $this->proxies->assign($tenant);

        // Email the invoice PDF for a genuine paid activation only (free grants
        // never reach here). Best-effort — a mail failure must not break activation.
        if ($paid && $amount !== null) {
            $this->emailInvoice($tenant, $period, $settings);
        }

        $this->notifier->toTenant($tenant->id, 'subscription_activated', ['days' => $days], '/subscription');
        $reseller = $ledgerEntry?->collector()->with('user')->first()?->user;
        if ($reseller !== null && $usedCode !== null) {
            $this->notifier->toUser($reseller, 'code_activated', ['company' => $tenant->name, 'code' => $usedCode], '/reseller');
        }
    }

    /**
     * Render and email the invoice PDF to the company's managers. Fully guarded:
     * any rendering or transport failure is logged and swallowed so activation
     * always succeeds.
     */
    private function emailInvoice(Tenant $tenant, SubscriptionPeriod $period, InvoiceSettings $settings): void
    {
        try {
            $recipients = User::where('tenant_id', $tenant->id)
                ->whereNotNull('email')
                ->pluck('email')
                ->all();
            if ($recipients === []) {
                return;
            }

            $pdf = $this->invoices->pdf($period, $settings)->output();
            $mail = new InvoiceMail($period->invoiceNumber(), $tenant->name, $pdf);
            Mail::to($recipients)->send($mail);
        } catch (Throwable $e) {
            Log::warning('invoice_email_failed', ['tenant_id' => $tenant->id, 'error' => $e->getMessage()]);
        }
    }

    /** The monthly plan: an active ~30-day plan, else the shortest active plan. */
    private function monthlyPlan(): ?Plan
    {
        return Plan::query()->where('active', true)
            ->whereBetween('duration_days', [28, 31])
            ->orderBy('duration_days')
            ->first()
            ?? Plan::query()->where('active', true)->orderBy('duration_days')->first();
    }
}
