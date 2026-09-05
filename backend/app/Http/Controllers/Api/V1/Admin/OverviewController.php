<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Platform overview for the super-admin dashboard: headline stats + a list of
 * companies that need attention (expired/needs-relink session, no proxy).
 */
class OverviewController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $tenants = Tenant::query()->get();
        // Newest session per tenant. keyBy keeps the LAST row for a duplicate key, so
        // with a desc sort that would keep the OLDEST — unique() (keeps the first)
        // after the desc sort keeps the newest, which is the session that's live.
        $sessions = UberFleetSession::withoutGlobalScopes()
            ->orderByDesc('updated_at')->get()->unique('tenant_id')->keyBy('tenant_id');

        // "Active" means truly active (subscription live, not banned/expired/
        // disabled) — the same stateReason() rule the company row + ingest guards
        // use — so the health donut can't disagree with the row's status badge.
        $activeCompanies = $tenants->filter(fn (Tenant $t) => $t->stateReason() === null);

        // Session health covers only the companies we actually serve (active ones):
        // a stopped/expired company's session is moot. Bucket each active company by
        // the SAME per-tenant session status the companies list reads ($sessions is
        // keyed by tenant_id), so this donut can never disagree with the row's badge.
        $breakdown = ['active' => 0, 'expired' => 0, 'needs_relink' => 0, 'no_session' => 0];
        foreach ($activeCompanies as $tenant) {
            $status = $sessions->get($tenant->id)?->status;
            $breakdown[in_array($status, ['active', 'expired', 'needs_relink'], true) ? $status : 'no_session']++;
        }

        // Platform-wide fleet counts — total drivers still on a company roster (the
        // active fleet, orphans excluded) and how many are online right now, for the
        // overview's drivers stat card and the /admin/drivers directory page.
        $driversTotal = Driver::withoutGlobalScopes()->activeFleet()->count();
        $driversOnline = Driver::withoutGlobalScopes()->activeFleet()->online()->count();

        $stats = [
            'companies' => $tenants->count(),
            'active_companies' => $activeCompanies->count(),
            'drivers' => Driver::withoutGlobalScopes()->count(),
            'drivers_total' => $driversTotal,
            'drivers_online' => $driversOnline,
            'offers' => DispatchOffer::withoutGlobalScopes()->count(),
            'sessions_active' => $breakdown['active'],
            'sessions_need_attention' => $breakdown['expired'] + $breakdown['needs_relink'],
        ];

        // Alerts — companies the super-admin should act on.
        $alerts = [];
        foreach ($tenants as $tenant) {
            // Only active companies raise session/proxy alerts — a stopped/expired/
            // banned one isn't our concern until it's active again.
            if ($tenant->stateReason() !== null) {
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

        // Our own proxy subscriptions expiring within 5 days — renew before the
        // companies on them lose their exit IP.
        $expiringProxies = Proxy::query()
            ->whereNotNull('expires_at')
            ->whereDate('expires_at', '<=', CarbonImmutable::now()->addDays(5))
            ->orderBy('expires_at')
            ->get()
            ->map(fn (Proxy $p) => [
                'id' => $p->id,
                'label' => $p->label,
                'expires_at' => $p->expires_at?->toDateString(),
                'days_left' => (int) CarbonImmutable::now()->startOfDay()->diffInDays($p->expires_at->startOfDay(), false),
            ]);

        return response()->json(['data' => [
            'stats' => $stats,
            'alerts' => $alerts,
            'expiring_proxies' => $expiringProxies,
            'session_breakdown' => $breakdown,
            'offers_daily' => $this->offersDaily(),
            'top_companies' => $this->topCompanies($tenants),
        ]]);
    }

    /** Platform-wide offer volume for the last 14 days (zero-filled). */
    private function offersDaily(): array
    {
        $since = CarbonImmutable::now()->subDays(13)->startOfDay();

        $counts = DispatchOffer::withoutGlobalScopes()
            ->where('received_at', '>=', $since)
            ->groupBy('day')
            ->orderBy('day')
            ->pluck(DB::raw('count(*) as c'), DB::raw('date(received_at) as day'));

        $out = [];
        for ($i = 0; $i < 14; $i++) {
            $day = $since->addDays($i)->toDateString();
            $out[] = ['date' => $day, 'count' => (int) ($counts[$day] ?? 0)];
        }

        return $out;
    }

    /** Top 5 companies by captured offers (with their driver counts). */
    private function topCompanies($tenants): array
    {
        $offers = DispatchOffer::withoutGlobalScopes()
            ->selectRaw('tenant_id, count(*) c')->groupBy('tenant_id')->pluck('c', 'tenant_id');
        $drivers = Driver::withoutGlobalScopes()
            ->selectRaw('tenant_id, count(*) c')->groupBy('tenant_id')->pluck('c', 'tenant_id');

        return $tenants
            ->map(fn ($t) => [
                'company_id' => $t->id,
                'company' => $t->name,
                'offers' => (int) ($offers[$t->id] ?? 0),
                'drivers' => (int) ($drivers[$t->id] ?? 0),
            ])
            ->sortByDesc('offers')
            ->take(5)
            ->values()
            ->all();
    }

    /** @return array<string, mixed> */
    private function alert(Tenant $tenant, string $type): array
    {
        return ['company_id' => $tenant->id, 'company' => $tenant->name, 'type' => $type];
    }
}
