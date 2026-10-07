<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The link to El-Professor, a separate payroll product. It PULLS: the operator
 * mints a token here and pastes it into El-Professor, which then reads the
 * roster. Nothing is ever pushed to El-Professor from this side.
 *
 * The token holds only `elprofessor:read`, which EnsureDashboardToken confines
 * to the roster and fleet-identity routes below.
 */
class ElProfessorController extends Controller
{
    private const MAX_PER_PAGE = 100;

    private const LAST_USED_INTERVAL_MINUTES = 60;

    public function issueToken(Request $request): JsonResponse
    {
        $user = $request->user();
        $tenant = Tenant::query()->findOrFail($user->tenant_id);

        // One link per company: replace every earlier token, whoever minted it.
        $tenant->elprofessorTokens()->delete();
        $token = $user->createToken('elprofessor', ['elprofessor:read'])->plainTextToken;

        $tenant->mergeElprofessorState([
            'token_issued_at' => now()->toIso8601String(),
            'revoked_at' => null,
            'first_used_at' => null,
            'last_used_at' => null,
        ]);

        return response()->json(['data' => [
            'token' => $token,
            'tenant_id' => $tenant->id,
            'tenant_name' => $tenant->name,
            'payment_reference' => $tenant->ensurePaymentReference(),
        ]]);
    }

    public function revokeToken(Request $request): JsonResponse
    {
        $tenant = Tenant::query()->findOrFail($request->user()->tenant_id);

        $tenant->elprofessorTokens()->delete();
        $tenant->mergeElprofessorState(['revoked_at' => now()->toIso8601String()]);

        return response()->json(['data' => $tenant->fresh()->elprofessorConnection()]);
    }

    /** Never returns the token itself. */
    public function connection(Request $request): JsonResponse
    {
        $tenant = Tenant::query()->findOrFail($request->user()->tenant_id);

        return response()->json(['data' => $tenant->elprofessorConnection()]);
    }

    /**
     * Who this token belongs to. The only identity a confined token can read,
     * so El-Professor can check it matches the fleet the operator named.
     * Deliberately three fields: no settings, counts or connection timestamps.
     */
    public function fleet(Request $request): JsonResponse
    {
        $tenant = Tenant::query()->findOrFail($request->user()->tenant_id);

        $this->recordUsage($tenant->id);

        return response()->json(['data' => [
            'tenant_id' => $tenant->id,
            'tenant_name' => $tenant->name,
            'payment_reference' => $tenant->ensurePaymentReference(),
        ]]);
    }

    public function drivers(Request $request): JsonResponse
    {
        $tenantId = (int) $request->user()->tenant_id;
        $perPage = max(1, min(self::MAX_PER_PAGE, (int) $request->query('per_page', 50)));

        $page = Driver::query()
            ->where('tenant_id', $tenantId)
            ->orderBy('id')
            ->select(['id', 'name', 'email', 'phone', 'employment_type', 'uber_driver_uuid', 'activated_at', 'roster_removed_at'])
            ->paginate($perPage);

        $this->recordUsage($tenantId);

        return response()->json([
            'data' => $page->getCollection()->map(fn (Driver $d) => [
                'id' => $d->id,
                'name' => $d->name,
                'email' => $d->email,
                'phone' => $d->phone,
                'employment_type' => $d->employment_type,
                'uber_driver_uuid' => $d->uber_driver_uuid,
                'activated_at' => $d->activated_at?->toIso8601String(),
                'roster_removed_at' => $d->roster_removed_at?->toIso8601String(),
            ])->values(),
            'meta' => [
                'page' => $page->currentPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
                'tenant_id' => $tenantId,
            ],
        ]);
    }

    /**
     * first_used_at is set once; last_used_at at most once an hour, so a pull
     * does not write on every request. Locked so two pulls cannot clobber the
     * other settings keys.
     */
    private function recordUsage(int $tenantId): void
    {
        DB::transaction(function () use ($tenantId) {
            $tenant = Tenant::query()->lockForUpdate()->findOrFail($tenantId);
            $state = $tenant->settings['elprofessor'] ?? [];
            $now = now();
            $changes = [];

            if (empty($state['first_used_at'])) {
                $changes['first_used_at'] = $now->toIso8601String();
            }
            $last = $state['last_used_at'] ?? null;
            if ($last === null || $now->diffInMinutes(\Illuminate\Support\Carbon::parse($last), true) >= self::LAST_USED_INTERVAL_MINUTES) {
                $changes['last_used_at'] = $now->toIso8601String();
            }

            if ($changes !== []) {
                $tenant->mergeElprofessorState($changes);
            }
        });
    }
}
