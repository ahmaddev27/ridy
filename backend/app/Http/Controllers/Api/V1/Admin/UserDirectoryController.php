<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;

/**
 * Super-admin directory of every platform user — managers, resellers, admins —
 * with their account type (role), company and status. Read-only overview.
 */
class UserDirectoryController extends Controller
{
    public function index(): JsonResponse
    {
        $users = User::query()
            ->with(['roles:id,name', 'tenant:id,name,status,banned_at,subscription_ends_at'])
            ->orderBy('name')
            ->get()
            ->map(fn (User $u) => [
                'id' => $u->id,
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

        return response()->json(['data' => $users]);
    }
}
