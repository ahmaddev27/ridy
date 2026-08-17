<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * Super-admin "act as company": swaps the dashboard session identity to one of
 * the tenant's managers so the admin can drive the manager-only Uber connect
 * flow (capture a fresh supplier session) without the company's help. The
 * original admin id is stashed in the session so it can be restored on stop.
 *
 * Only reachable from the super-admin group (start); stop lives on the plain
 * authenticated group because, mid-impersonation, the caller is a manager.
 */
class ImpersonationController extends Controller
{
    /** Session key holding the original super-admin id while impersonating. */
    public const KEY = 'impersonator_id';

    public function start(Tenant $tenant, Request $request): JsonResponse
    {
        // Prefer a real manager; fall back to any user bound to the tenant.
        $target = User::where('tenant_id', $tenant->id)
            ->whereHas('roles', fn ($q) => $q->where('name', 'fleet_manager'))
            ->orderBy('id')
            ->first()
            ?? User::where('tenant_id', $tenant->id)->orderBy('id')->first();

        abort_if($target === null, 422, 'This company has no user account to act as.');
        abort_unless($request->hasSession(), 419, 'A dashboard session is required to impersonate.');

        // Remember who started, then switch identity. migrate(true) inside the
        // guard keeps this key across the session-id regeneration.
        $request->session()->put(self::KEY, $request->user()->id);
        Auth::guard('web')->login($target);

        return response()->json([
            'data' => [
                'user' => new UserResource($target->load('tenant')),
                'company' => $tenant->name,
            ],
        ]);
    }

    public function stop(Request $request): JsonResponse
    {
        abort_unless($request->hasSession(), 409, 'Not impersonating.');

        $originalId = $request->session()->get(self::KEY);
        abort_if($originalId === null, 409, 'Not impersonating.');

        $original = User::find($originalId);
        abort_if($original === null, 409, 'Original account is gone.');

        $request->session()->forget(self::KEY);
        Auth::guard('web')->login($original);

        return response()->json(['data' => new UserResource($original->load('tenant'))]);
    }
}
