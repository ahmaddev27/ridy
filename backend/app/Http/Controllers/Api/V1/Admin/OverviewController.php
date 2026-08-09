<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * Platform overview for the super-admin dashboard: headline stats + a list of
 * companies that need attention (expired/needs-relink session, no proxy).
 */
class OverviewController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $tenants = Tenant::query()->get();
        $sessions = UberFleetSession::withoutGlobalScopes()->orderByDesc('updated_at')->get()->keyBy('tenant_id');

        $stats = [
            'companies' => $tenants->count(),
            'active_companies' => $tenants->where('status', 'active')->count(),
            'drivers' => Driver::withoutGlobalScopes()->count(),
            'offers' => DispatchOffer::withoutGlobalScopes()->count(),
            'sessions_active' => $sessions->where('status', 'active')->count(),
            'sessions_need_attention' => $sessions->whereIn('status', ['expired', 'needs_relink'])->count(),
        ];

        // Alerts — companies the super-admin should act on.
        $alerts = [];
        foreach ($tenants as $tenant) {
            if ($tenant->status !== 'active') {
                continue;
            }
            $session = $sessions->get($tenant->id);
            if ($session === null) {
                $alerts[] = $this->alert($tenant, 'no_session');
            } elseif (in_array($session->status, ['expired', 'needs_relink'], true)) {
                $alerts[] = $this->alert($tenant, $session->status);
            }
            if ($tenant->getAttribute('proxy_url') === null) {
                $alerts[] = $this->alert($tenant, 'no_proxy');
            }
        }

        return response()->json(['data' => ['stats' => $stats, 'alerts' => $alerts]]);
    }

    /** @return array<string, mixed> */
    private function alert(Tenant $tenant, string $type): array
    {
        return ['company_id' => $tenant->id, 'company' => $tenant->name, 'type' => $type];
    }
}
