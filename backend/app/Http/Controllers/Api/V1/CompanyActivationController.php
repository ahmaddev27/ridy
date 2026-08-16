<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\ProxyPool;
use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Http\Controllers\Controller;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * A company owner activates (or renews) their subscription by entering the code
 * the admin generated. Three wrong codes ban the account until an admin lifts it.
 */
class CompanyActivationController extends Controller
{
    use GeneratesOtp;

    private const MAX_ATTEMPTS = 3;

    public function activate(Request $request, Notifier $notifier): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'code' => ['required', 'digits:6'],
        ]);

        $user = User::where('email', $data['email'])->first();
        if (! $user || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => [__('auth.failed')]]);
        }

        $tenant = $user->tenant;
        if ($tenant === null) {
            throw ValidationException::withMessages(['code' => 'activation_no_company']);
        }
        if ($tenant->banned_at !== null) {
            return response()->json(['message' => 'account_suspended', 'reason' => 'banned'], 403);
        }
        $testCode = $this->isTestCode($data['code']);
        if ($tenant->activation_code === null || ($tenant->activation_code_expires_at?->isPast() && ! $testCode)) {
            throw ValidationException::withMessages(['code' => 'activation_expired']);
        }

        if (! hash_equals($tenant->activation_code, $data['code']) && ! $testCode) {
            $tenant->increment('activation_attempts');
            if ($tenant->activation_attempts >= self::MAX_ATTEMPTS) {
                $tenant->forceFill(['banned_at' => CarbonImmutable::now()])->save();
                $notifier->toAdmins('company_banned', ['company' => $tenant->name], '/admin/companies');

                return response()->json(['message' => 'account_suspended', 'reason' => 'banned'], 403);
            }
            throw ValidationException::withMessages(['code' => 'otp_incorrect']);
        }

        $days = (int) $tenant->activation_days;
        $amount = $tenant->activation_amount; // set by the admin/reseller at code generation
        $paid = (bool) $tenant->activation_paid;
        $soldBy = $tenant->activation_collector_id; // the reseller who issued the code
        $usedCode = $tenant->activation_code; // captured before we clear it, to close the ledger entry
        $startsAt = CarbonImmutable::now();
        $endsAt = $startsAt->addDays($days);

        $tenant->forceFill([
            'status' => 'active',
            'banned_at' => null,
            'activated_at' => $startsAt,
            'subscription_ends_at' => $endsAt,
            'activation_code' => null,
            'activation_code_expires_at' => null,
            'activation_days' => null,
            'activation_amount' => null,
            'activation_paid' => false,
            'activation_collector_id' => null,
            'activation_attempts' => 0,
        ])->save();

        // Record the period as an invoice. Marked paid immediately if the admin
        // said so at code generation; otherwise it stays open until a collector
        // payment settles it. sold_by tags the reseller who issued the code.
        $period = SubscriptionPeriod::create([
            'tenant_id' => $tenant->id,
            'days' => $days,
            'amount' => $amount,
            'paid_at' => $paid ? $startsAt : null,
            'sold_by_collector_id' => $soldBy,
            'starts_at' => $startsAt,
            'ends_at' => $endsAt,
        ]);

        // Close the ledger entry: mark the issued code activated and link it to
        // the period it created.
        $ledgerEntry = SubscriptionCode::where('tenant_id', $tenant->id)
            ->where('code', $usedCode)
            ->whereNull('activated_at')
            ->latest('id')
            ->first();
        $ledgerEntry?->forceFill([
            'activated_at' => $startsAt,
            'subscription_period_id' => $period->id,
        ])->save();

        // Now that it's active, place it on a proxy from the pool.
        app(ProxyPool::class)->assign($tenant);

        // Notify the company managers, and the reseller whose code was activated.
        $notifier->toTenant($tenant->id, 'subscription_activated', ['days' => $days], '/subscription');
        $reseller = $ledgerEntry?->collector()->with('user')->first()?->user;
        $notifier->toUser($reseller, 'code_activated', ['company' => $tenant->name, 'code' => $usedCode], '/reseller');

        return response()->json(['data' => ['activated' => true]]);
    }
}
