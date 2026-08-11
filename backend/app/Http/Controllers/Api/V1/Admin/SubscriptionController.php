<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Http\Controllers\Controller;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super-admin control over company subscriptions: generate a short-lived
 * activation code the owner enters, review companies locked out after too many
 * wrong codes, and reactivate them.
 */
class SubscriptionController extends Controller
{
    use GeneratesOtp;

    private const CODE_TTL_MINUTES = 2;

    /** Generate an activation code valid ~2 minutes for the owner to enter. */
    public function generate(Request $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validate([
            'days' => ['required', 'integer', 'min:1', 'max:3650'],
        ]);

        $code = $this->newOtp();
        $tenant->forceFill([
            'activation_code' => $code,
            'activation_code_expires_at' => CarbonImmutable::now()->addMinutes(self::CODE_TTL_MINUTES),
            'activation_days' => $data['days'],
            'activation_attempts' => 0,
        ])->save();

        return response()->json(['data' => [
            'code' => $code,
            'days' => $data['days'],
            'expires_at' => $tenant->activation_code_expires_at->toIso8601String(),
        ]]);
    }

    /** Companies locked out after 3 wrong activation codes — with owner phones. */
    public function banned(): JsonResponse
    {
        $tenants = Tenant::whereNotNull('banned_at')->orderByDesc('banned_at')->get();

        $owners = User::whereIn('tenant_id', $tenants->pluck('id'))
            ->orderBy('id')->get()->groupBy('tenant_id');

        $rows = $tenants->map(function (Tenant $t) use ($owners) {
            $owner = $owners->get($t->id)?->first();

            return [
                'id' => $t->id,
                'name' => $t->name,
                'banned_at' => $t->banned_at?->toIso8601String(),
                'owner_name' => $owner?->name,
                'owner_email' => $owner?->email,
                'owner_phone' => $owner?->phone,
            ];
        });

        return response()->json(['data' => $rows]);
    }

    /** Lift a ban and reactivate the account (admin does this after contact). */
    public function reactivate(Tenant $tenant): JsonResponse
    {
        $tenant->forceFill([
            'status' => 'active',
            'banned_at' => null,
            'activation_attempts' => 0,
            'activation_code' => null,
            'activation_code_expires_at' => null,
        ])->save();

        return response()->json(['data' => ['reactivated' => true]]);
    }
}
