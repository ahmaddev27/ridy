<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Collections\Models\Collector;
use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super-admin directory of every platform user — managers, resellers, admins —
 * with their account type (role), company and status. Read-only overview.
 */
class UserDirectoryController extends Controller
{
    /** Tenant columns stateReason() reads (activated_at included — without it a
     *  company with an open-ended subscription read as "inactive"). */
    private const TENANT = 'tenant:id,name,status,banned_at,activated_at,subscription_ends_at';

    /**
     * Optional filters (the dashboard still loads the whole list): `q` matches
     * name/email/phone, `kind` = user|driver, `company_id`. Only the columns the
     * rows use are loaded — full Driver rows carry large JSON columns.
     */
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'kind' => ['nullable', 'in:user,driver'],
            'company_id' => ['nullable', 'integer'],
        ]);
        $search = function ($query) use ($filters) {
            $query->when($filters['q'] ?? null, fn ($q, string $term) => $q->where(function ($w) use ($term) {
                $like = '%'.addcslashes($term, '%_\\').'%';
                $w->where('name', 'like', $like)->orWhere('email', 'like', $like)->orWhere('phone', 'like', $like);
            }))->when($filters['company_id'] ?? null, fn ($q, $id) => $q->where('tenant_id', $id));
        };
        $kind = $filters['kind'] ?? null;

        $users = $kind === 'driver' ? collect() : User::query()
            ->select(['id', 'name', 'email', 'phone', 'tenant_id'])
            ->with(['roles:id,name', self::TENANT])
            ->tap($search)
            ->orderBy('name')
            ->get()
            ->map(fn (User $u) => [
                'id' => $u->id,
                'kind' => 'user',
                'name' => $u->name,
                'email' => $u->email,
                'phone' => $u->phone,
                'role' => $u->roles->pluck('name')->first() ?? 'user',
                'company' => $u->tenant?->name,
                'company_id' => $u->tenant_id,
                // A user is blocked when their company is (managers) — resellers
                // and admins have no company, so they're simply active.
                'status' => $u->tenant !== null ? ($u->tenant->stateReason() ?? 'active') : 'active',
            ]);

        // Activated app drivers, so a super-admin can send them a test push. They
        // carry kind:'driver' (their id lives in a separate table from users) and
        // are pushed via their device tokens, not a bell entry.
        $drivers = $kind === 'user' ? collect() : Driver::withoutGlobalScopes()
            ->select(['id', 'name', 'email', 'phone', 'tenant_id', 'activated_at'])
            ->whereNotNull('activated_at')
            ->with(self::TENANT)
            ->tap($search)
            ->orderBy('name')
            ->get()
            ->map(fn (Driver $d) => [
                'id' => $d->id,
                'kind' => 'driver',
                'name' => $d->name,
                'email' => $d->email,
                'phone' => $d->phone,
                'role' => 'driver',
                'company' => $d->tenant?->name,
                'company_id' => $d->tenant_id,
                'status' => $d->tenant?->stateReason() ?? 'active',
            ]);

        return response()->json(['data' => $users->concat($drivers)->values()]);
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        // Never let an admin delete themselves or another super-admin by accident.
        if ($user->id === $request->user()->id || $user->hasRole('super_admin')) {
            return response()->json(['message' => 'cannot_delete_admin'], 422);
        }

        // A reseller whose collector received cash payments is kept (ledger rows are
        // accounting records; the DB FK also restricts the delete).
        if (Collector::where('user_id', $user->id)->whereHas('payments')->exists()) {
            return response()->json(['message' => 'collector_has_payments'], 422);
        }

        // A reseller login and its collector are one entity — remove both, so the
        // collector never lingers after its user is deleted. Issued codes survive
        // (their collector_id is nulled by the FK).
        Collector::where('user_id', $user->id)->delete();
        $user->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }
}
