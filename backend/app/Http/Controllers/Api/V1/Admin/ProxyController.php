<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\ProxyRenewal;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super-admin management of the shared residential-proxy pool. `url` carries
 * credentials, so lists only ever expose a masked form.
 */
class ProxyController extends Controller
{
    public function index(): JsonResponse
    {
        $proxies = Proxy::with('renewals')->orderBy('label')->get()->map(fn (Proxy $p) => $this->present($p));

        return response()->json(['data' => $proxies]);
    }

    /**
     * Renew a proxy on the SAME credentials: record another paid period (amount +
     * start/end) so the spend accumulates and the expiry moves to the new end. The
     * base row is untouched — the history and running total live in the renewals.
     */
    public function renew(Request $request, Proxy $proxy): JsonResponse
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date', 'after_or_equal:starts_at'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        $proxy->renewals()->create($data);

        return response()->json(['data' => $this->present($proxy->load('renewals'))]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, creating: true);
        $proxy = Proxy::create($data);

        return response()->json(['data' => $this->present($proxy)], 201);
    }

    public function update(Request $request, Proxy $proxy): JsonResponse
    {
        $data = $this->validated($request, creating: false);
        // Keep the existing URL when the admin leaves it blank (not re-entering creds).
        if (empty($data['url'])) {
            unset($data['url']);
        }
        $proxy->update($data);

        return response()->json(['data' => $this->present($proxy->fresh())]);
    }

    public function destroy(Proxy $proxy): JsonResponse
    {
        // Assigned tenants have proxy_id nulled by the FK (nullOnDelete).
        $proxy->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, bool $creating): array
    {
        return $request->validate([
            'label' => ['required', 'string', 'max:255'],
            'url' => [$creating ? 'required' : 'nullable', 'string', 'max:1000'],
            'capacity' => ['required', 'integer', 'min:1', 'max:10000'],
            'price' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'source' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string', 'max:500'],
            'starts_at' => ['nullable', 'date'],
            'expires_at' => ['nullable', 'date'],
        ]);
    }

    /** @return array<string, mixed> */
    private function present(Proxy $p): array
    {
        $used = $p->usedCount();

        // The real expiry is the furthest end across the base period and renewals.
        $end = $p->effectiveEndsAt();
        $daysLeft = $end !== null
            ? (int) now()->startOfDay()->diffInDays($end->startOfDay(), false)
            : null;

        return [
            'id' => $p->id,
            'label' => $p->label,
            'url_masked' => preg_replace('#//[^@/]*@#', '//••••@', $p->url),
            'capacity' => $p->capacity,
            'used' => $used,
            'free' => max(0, $p->capacity - $used),
            'near_full' => $p->capacity > 0 && $used / $p->capacity >= 0.8,
            'price' => $p->price !== null ? (float) $p->price : null,
            'total_paid' => $p->totalPaid(),
            'source' => $p->source,
            'notes' => $p->notes,
            'starts_at' => $p->starts_at?->toDateString(),
            // The base (first) period end — what the edit form edits.
            'expires_at' => $p->expires_at?->toDateString(),
            // The effective expiry after renewals — what the badge/countdown uses.
            'ends_at' => $end?->toDateString(),
            'days_left' => $daysLeft,
            'expiring' => $daysLeft !== null && $daysLeft <= 5,
            'renewals' => $p->renewals->map(fn (ProxyRenewal $r) => [
                'id' => $r->id,
                'amount' => (float) $r->amount,
                'starts_at' => $r->starts_at?->toDateString(),
                'ends_at' => $r->ends_at?->toDateString(),
                'note' => $r->note,
            ])->values(),
        ];
    }
}
