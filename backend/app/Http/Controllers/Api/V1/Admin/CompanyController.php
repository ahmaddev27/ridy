<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\ProxyPool;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Admin\StoreCompanyRequest;
use App\Http\Requests\Api\V1\Admin\UpdateCompanyRequest;
use App\Http\Resources\Admin\CompanyResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Super-admin CRUD over companies (tenants). Cross-tenant by design — this route
 * group runs without ResolveTenant, and scoped models are read via
 * withoutGlobalScopes() with explicit tenant grouping so stats never leak.
 */
class CompanyController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        $tenants = Tenant::query()->orderBy('name')->get();

        // Per-tenant counts in 3 grouped queries (no N+1).
        $driverCounts = Driver::withoutGlobalScopes()
            ->selectRaw('tenant_id, count(*) c')->groupBy('tenant_id')->pluck('c', 'tenant_id');
        $offerCounts = DispatchOffer::withoutGlobalScopes()
            ->selectRaw('tenant_id, count(*) c')->groupBy('tenant_id')->pluck('c', 'tenant_id');
        $sessions = UberFleetSession::withoutGlobalScopes()
            ->orderByDesc('updated_at')->get()->keyBy('tenant_id');

        // Tenants with at least one email-verified user (self-registered companies
        // always have one). One grouped query — no N+1.
        $verifiedTenantIds = User::query()->whereNotNull('email_verified_at')
            ->distinct()->pluck('tenant_id')->flip();

        $tenants->each(function (Tenant $t) use ($driverCounts, $offerCounts, $sessions, $verifiedTenantIds) {
            $t->setAttribute('driver_count', $driverCounts[$t->id] ?? 0);
            $t->setAttribute('offer_count', $offerCounts[$t->id] ?? 0);
            $t->setAttribute('session_info', $this->sessionInfo($sessions->get($t->id)));
            $t->setAttribute('email_verified', $verifiedTenantIds->has($t->id));
        });

        return CompanyResource::collection($tenants);
    }

    public function store(StoreCompanyRequest $request): JsonResponse
    {
        $data = $request->validated();

        $tenant = DB::transaction(function () use ($data) {
            $tenant = Tenant::create([
                'name' => $data['name'],
                'country' => $data['country'] ?? 'DE',
                'status' => $data['status'] ?? 'active',
                'uber_org_uuid' => $data['uber_org_uuid'] ?? null,
                'proxy_url' => $data['proxy_url'] ?? null,
            ]);

            // Optional first manager, created atomically with the company.
            if (! empty($data['manager_email'])) {
                User::create([
                    'name' => $data['manager_name'],
                    'email' => $data['manager_email'],
                    'password' => Hash::make($data['manager_password']),
                    'tenant_id' => $tenant->id,
                ])->assignRole('fleet_manager');
            }

            return $tenant;
        });

        // Auto-assign a pool proxy when the admin didn't set one explicitly.
        if (empty($data['proxy_url']) && $tenant->isUsable()) {
            app(ProxyPool::class)->assign($tenant);
        }

        return response()->json(['data' => $this->detail($tenant)], 201);
    }

    public function show(Tenant $tenant): JsonResponse
    {
        return response()->json(['data' => $this->detail($tenant)]);
    }

    public function update(UpdateCompanyRequest $tenantRequest, Tenant $tenant): JsonResponse
    {
        $data = $tenantRequest->validated();

        // Only touch proxy_url when the admin actually submitted the field; an
        // empty string clears it (→ falls back to the global proxy).
        if (array_key_exists('proxy_url', $data)) {
            $tenant->proxy_url = $data['proxy_url'] !== '' ? $data['proxy_url'] : null;
        }
        unset($data['proxy_url']);
        $tenant->fill($data)->save();

        // Re-enabling a company (or extending its subscription) should place it back
        // on a pool proxy if it has none.
        if ($tenant->isUsable() && $tenant->proxy_id === null && blank($tenant->proxy_url)) {
            app(ProxyPool::class)->assign($tenant);
        }

        return response()->json(['data' => $this->detail($tenant->fresh())]);
    }

    /** Disable (reversible) — keeps offers/session history. */
    /**
     * Permanently delete a company and everything scoped to it — Uber session
     * (which stops its daemon stream on the next reconcile), drivers, offers,
     * device tokens, audit logs, and its users (with their notifications and API
     * tokens). Runs in one transaction so it either fully succeeds or rolls back.
     */
    public function destroy(Tenant $tenant): JsonResponse
    {
        DB::transaction(function () use ($tenant) {
            $userIds = DB::table('users')->where('tenant_id', $tenant->id)->pluck('id');

            // The users' notifications + API tokens (polymorphic, no tenant_id).
            if ($userIds->isNotEmpty()) {
                DB::table('notifications')
                    ->where('notifiable_type', User::class)
                    ->whereIn('notifiable_id', $userIds)->delete();
                DB::table('personal_access_tokens')
                    ->where('tokenable_type', User::class)
                    ->whereIn('tokenable_id', $userIds)->delete();
            }

            // Everything scoped directly to the tenant.
            foreach (['device_tokens', 'dispatch_offers', 'drivers', 'uber_fleet_sessions', 'audit_logs', 'users'] as $table) {
                DB::table($table)->where('tenant_id', $tenant->id)->delete();
            }

            $tenant->delete();
        });

        return response()->json(['data' => ['deleted' => true]]);
    }

    /** Full detail with stats, users and session — proxy_url unmasked (edit form). */
    private function detail(Tenant $tenant): CompanyResource
    {
        $tenant->setAttribute('driver_count', Driver::withoutGlobalScopes()->where('tenant_id', $tenant->id)->count());
        $tenant->setAttribute('offer_count', DispatchOffer::withoutGlobalScopes()->where('tenant_id', $tenant->id)->count());
        $tenant->setAttribute('session_info', $this->sessionInfo(
            UberFleetSession::withoutGlobalScopes()->where('tenant_id', $tenant->id)->orderByDesc('updated_at')->first()
        ));
        $tenant->setAttribute('users_list', User::where('tenant_id', $tenant->id)->orderBy('name')->get());
        $tenant->setAttribute('email_verified', User::where('tenant_id', $tenant->id)->whereNotNull('email_verified_at')->exists());

        return CompanyResource::detail($tenant);
    }

    /** @return array<string, mixed>|null */
    private function sessionInfo(?UberFleetSession $session): ?array
    {
        if ($session === null) {
            return null;
        }

        return [
            'status' => $session->status,
            'last_event_at' => $session->last_event_at?->toIso8601String(),
            'expires_at' => $session->expires_at?->toIso8601String(),
        ];
    }
}
