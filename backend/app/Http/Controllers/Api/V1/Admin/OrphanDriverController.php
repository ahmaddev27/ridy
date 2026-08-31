<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super-admin directory of "orphaned" drivers: people we synced from a company's
 * Uber roster before, who have since been dropped from it (roster_removed_at set)
 * — so they are registered in our system but no longer belong to an active
 * company. Exposes their contact details so an admin can reach out (e.g. to place
 * them with another fleet). Ordered most-recently-dropped first.
 */
class OrphanDriverController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $drivers = Driver::withoutGlobalScopes()
            ->whereNotNull('roster_removed_at')
            ->with('tenant:id,name')
            ->when($request->filled('search'), function ($q) use ($request) {
                $term = '%'.$request->string('search').'%';
                $q->where(fn ($sub) => $sub
                    ->where('name', 'like', $term)
                    ->orWhere('phone', 'like', $term)
                    ->orWhere('email', 'like', $term)
                    ->orWhere('uber_email', 'like', $term));
            })
            // App-registered drivers first (activated), then by most-recently dropped.
            ->orderByRaw('activated_at IS NULL')
            ->orderByDesc('roster_removed_at')
            ->paginate(min(100, max(10, (int) $request->integer('per_page', 25))))
            ->withQueryString();

        $drivers->getCollection()->transform(fn (Driver $d) => [
            'id' => $d->id,
            'name' => $d->name,
            'phone' => $d->phone,
            'email' => $d->email,
            'uber_email' => $d->uber_email,
            'uber_picture_url' => $d->uber_picture_url,
            'uber_rating' => $d->uber_rating,
            'uber_total_trips' => $d->uber_total_trips,
            // The company they were last synced under (may itself still exist).
            'former_company' => $d->tenant?->name,
            'former_company_id' => $d->tenant_id,
            // Whether they ever registered/activated our driver app — the ones who
            // did are warmer contacts.
            'app_registered' => $d->activated_at !== null,
            'roster_removed_at' => $d->roster_removed_at?->toIso8601String(),
            'activated_at' => $d->activated_at?->toIso8601String(),
            'last_login_at' => $d->last_login_at?->toIso8601String(),
        ]);

        return response()->json($drivers);
    }
}
