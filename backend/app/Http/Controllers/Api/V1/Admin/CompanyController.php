<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\CompanyDeleter;
use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\ProxyPool;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Admin\StoreCompanyRequest;
use App\Http\Requests\Api\V1\Admin\UpdateCompanyRequest;
use App\Http\Resources\Admin\CompanyResource;
use App\Models\User;
use App\Support\PlatformCounters;
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
    public function __construct(private PlatformCounters $counters) {}

    public function index(): AnonymousResourceCollection
    {
        $tenants = Tenant::query()->orderBy('name')->get();

        // Per-tenant driver/offer counts come from the shared platform-count cache
        // (a per-request full-table scan each would otherwise be); the session query
        // below stays live.
        $driverCounts = $this->counters->driversByTenant();
        $offerCounts = $this->counters->offersByTenant();
        // Newest session per tenant (unique() keeps the first of the desc-sorted rows,
        // so keyBy can't fall back to the oldest for a tenant with several sessions).
        $sessions = UberFleetSession::withoutGlobalScopes()
            ->orderByDesc('updated_at')->get()->unique('tenant_id')->keyBy('tenant_id');

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
        $tenant->ensurePaymentReference(); // backfill for any company created before the feature

        return response()->json(['data' => $this->detail($tenant)]);
    }

    public function update(UpdateCompanyRequest $tenantRequest, Tenant $tenant): JsonResponse
    {
        $data = $tenantRequest->validated();

        // Proxy is managed via the pool: choosing a proxy binds the company to it
        // (and copies its URL); clearing it releases the company.
        if (array_key_exists('proxy_id', $data)) {
            $proxy = $data['proxy_id'] ? Proxy::find($data['proxy_id']) : null;
            $tenant->proxy_id = $proxy?->id;
            $tenant->proxy_url = $proxy?->url;
        }
        unset($data['proxy_id']);
        $tenant->fill($data)->save();

        // Re-enabling a company (or extending its subscription) should place it back
        // on a pool proxy if it has none.
        if ($tenant->isUsable() && $tenant->proxy_id === null) {
            app(ProxyPool::class)->assign($tenant);
        }

        return response()->json(['data' => $this->detail($tenant->fresh())]);
    }

    /**
     * Permanently delete a company and everything scoped to it — Uber session
     * (which stops its daemon stream on the next reconcile), drivers, offers,
     * network logs, device tokens, audit logs, and its users (with their
     * notifications, roles and API tokens). A company that already has invoices or
     * cash payments is refused with 409: those are accounting records that must be
     * kept, so the admin disables the company (and purges its data) instead.
     */
    public function destroy(Tenant $tenant, CompanyDeleter $deleter): JsonResponse
    {
        if ($deleter->hasBillingRecords($tenant)) {
            return response()->json(['message' => 'company_has_billing_records'], 409);
        }

        $deleter->delete($tenant);

        $this->counters->forget();

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
        $tenant->setAttribute('proxy_label', $tenant->proxy_id ? optional($tenant->proxy)->label : null);

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
