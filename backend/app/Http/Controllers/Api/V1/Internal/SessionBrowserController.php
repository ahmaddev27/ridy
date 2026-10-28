<?php

namespace App\Http\Controllers\Api\V1\Internal;

use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\Models\FleetSessionOutage;
use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Internal (X-Dispatch-Secret) endpoints for the persistent session-browser
 * service: it reports per-company health and delivers the cookie jars it keeps
 * alive. Receive-and-store only — nothing here writes to Uber.
 */
class SessionBrowserController extends Controller
{
    /** Bulk health report: one row per company the service is responsible for. */
    public function status(Request $request): JsonResponse
    {
        $data = $request->validate([
            'browsers' => ['required', 'array'],
            'browsers.*.tenant_id' => ['nullable', 'integer'],
            'browsers.*.uber_org_uuid' => ['nullable', 'string'],
            'browsers.*.state' => ['required', 'string', Rule::in(SessionBrowser::STATES)],
            'browsers.*.last_login_at' => ['nullable', 'date'],
            'browsers.*.last_capture_at' => ['nullable', 'date'],
            'browsers.*.hard_reauth_count' => ['nullable', 'integer', 'min:0'],
            'browsers.*.consecutive_errors' => ['nullable', 'integer', 'min:0'],
        ]);

        $updated = 0;
        foreach ($data['browsers'] as $row) {
            $tenantId = $this->resolveTenantId($row);
            if ($tenantId === null) {
                continue;
            }
            $this->upsert($tenantId, $row);
            $updated++;
        }

        return response()->json(['data' => ['updated' => $updated]]);
    }

    /** A cookie jar the browser service captured; stored through the shared service. */
    public function capture(Request $request, Tenant $tenant, FleetSessionService $service): JsonResponse
    {
        $request->validate([
            'uber_org_uuid' => ['required', 'string'],
            'cookies' => ['required', 'array', 'min:1'],
            'cookies.*.name' => ['required', 'string'],
            'cookies.*.value' => ['required', 'string'],
            'supplier_cookies' => ['nullable', 'array'],
            'supplier_cookies.*.name' => ['required_with:supplier_cookies', 'string'],
            'supplier_cookies.*.value' => ['required_with:supplier_cookies', 'string'],
        ]);
        $orgUuid = (string) $request->string('uber_org_uuid');

        $blocked = $this->blockedReason($tenant, $orgUuid);
        if ($blocked !== null) {
            return response()->json(['data' => ['status' => 'blocked', 'reason' => $blocked]], 202);
        }

        $session = $service->capture(
            $tenant,
            $orgUuid,
            $request->array('cookies'),
            supplierCookies: $request->array('supplier_cookies') ?: null,
            via: FleetSessionOutage::VIA_BROWSER,
        );
        SessionBrowser::updateOrCreate(['tenant_id' => $tenant->id], ['last_capture_at' => CarbonImmutable::now()]);

        return response()->json(['data' => $session->only(['uber_org_uuid', 'status'])], 201);
    }

    /** Same silent-capture guards as the extension's non-manual path. */
    private function blockedReason(Tenant $tenant, string $orgUuid): ?string
    {
        if ($tenant->isAutolinkBlocked()) {
            return 'autolink_blocked';
        }

        $hasOtherOrg = UberFleetSession::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('uber_org_uuid', '!=', $orgUuid)
            ->exists();

        return $hasOtherOrg ? 'org_change_requires_connect' : null;
    }

    /** @param  array<string, mixed>  $row */
    private function resolveTenantId(array $row): ?int
    {
        if (! empty($row['tenant_id'])) {
            return Tenant::whereKey($row['tenant_id'])->value('id');
        }
        if (! empty($row['uber_org_uuid'])) {
            return Tenant::where('uber_org_uuid', $row['uber_org_uuid'])->value('id');
        }

        return null;
    }

    /** @param  array<string, mixed>  $row */
    private function upsert(int $tenantId, array $row): void
    {
        $values = ['state' => $row['state'], 'last_seen_at' => CarbonImmutable::now()];
        foreach (['last_login_at', 'last_capture_at', 'hard_reauth_count', 'consecutive_errors'] as $key) {
            if (array_key_exists($key, $row) && $row[$key] !== null) {
                $values[$key] = $row[$key];
            }
        }

        SessionBrowser::updateOrCreate(['tenant_id' => $tenantId], $values);
    }
}
