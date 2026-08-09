<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Admin\StoreCompanyRequest;
use App\Http\Requests\Api\V1\Admin\UpdateCompanyRequest;
use App\Http\Resources\Admin\CompanyResource;
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

        $tenants->each(function (Tenant $t) use ($driverCounts, $offerCounts, $sessions) {
            $t->setAttribute('driver_count', $driverCounts[$t->id] ?? 0);
            $t->setAttribute('offer_count', $offerCounts[$t->id] ?? 0);
            $t->setAttribute('session_info', $this->sessionInfo($sessions->get($t->id)));
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

        return response()->json(['data' => $this->detail($tenant->fresh())]);
    }

    /** Disable (reversible) — keeps offers/session history. */
    public function destroy(Tenant $tenant): JsonResponse
    {
        $tenant->update(['status' => 'disabled']);

        return response()->json(['data' => ['status' => 'disabled']]);
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
