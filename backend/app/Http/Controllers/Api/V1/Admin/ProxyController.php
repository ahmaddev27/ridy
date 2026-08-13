<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Tenancy\Models\Proxy;
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
        $proxies = Proxy::orderBy('label')->get()->map(fn (Proxy $p) => $this->present($p));

        return response()->json(['data' => $proxies]);
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
            'expires_at' => ['nullable', 'date'],
        ]);
    }

    /** @return array<string, mixed> */
    private function present(Proxy $p): array
    {
        $used = $p->usedCount();

        $daysLeft = $p->expires_at !== null
            ? (int) now()->startOfDay()->diffInDays($p->expires_at->startOfDay(), false)
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
            'source' => $p->source,
            'notes' => $p->notes,
            'expires_at' => $p->expires_at?->toDateString(),
            'days_left' => $daysLeft,
            'expiring' => $daysLeft !== null && $daysLeft <= 5,
        ];
    }
}
