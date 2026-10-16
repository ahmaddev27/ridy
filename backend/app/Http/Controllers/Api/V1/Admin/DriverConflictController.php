<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Fleet\DriverAccountTransferService;
use App\Domain\Fleet\DriverTransferRefused;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Models\DeviceToken;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super-admin view of drivers whose Uber UUID exists under MORE THAN ONE company,
 * and the manual account transfer between two such rows. Unlike the orphan list
 * it does not depend on roster_removed_at, which only the old company's own sync
 * ever sets, so a driver stranded behind an inactive company shows up here.
 */
class DriverConflictController extends Controller
{
    public function __construct(private readonly DriverAccountTransferService $transfers) {}

    public function index(Request $request): JsonResponse
    {
        // Deferred join: sort/paginate on id + the sort keys only, never the wide
        // driver JSON columns (avoids the 1038 sort-memory error), then load by id.
        $page = Driver::withoutGlobalScopes()
            ->select('id', 'uber_driver_uuid')
            ->whereIn('uber_driver_uuid', fn ($q) => $q->select('uber_driver_uuid')->from('drivers')
                ->whereNotNull('uber_driver_uuid')
                ->groupBy('uber_driver_uuid')
                ->havingRaw('COUNT(DISTINCT tenant_id) > 1'))
            ->orderBy('uber_driver_uuid')->orderBy('id')
            ->paginate(min(200, max(10, (int) $request->integer('per_page', 50))))
            ->withQueryString();

        $ids = $page->pluck('id');
        $rows = Driver::withoutGlobalScopes()->with('tenant')->whereIn('id', $ids)
            ->orderBy('uber_driver_uuid')->orderBy('id')->get();
        $devices = DeviceToken::withoutGlobalScopes()->whereIn('driver_id', $ids)
            ->selectRaw('driver_id, COUNT(*) as n')->groupBy('driver_id')->pluck('n', 'driver_id');

        $page->setCollection($rows->map(fn (Driver $d) => $this->row($d, (int) ($devices[$d->id] ?? 0))));

        return response()->json($page);
    }

    public function transfer(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from_driver_id' => ['required', 'integer'],
            'to_driver_id' => ['required', 'integer'],
        ]);
        $old = Driver::withoutGlobalScopes()->findOrFail($data['from_driver_id']);
        $new = Driver::withoutGlobalScopes()->findOrFail($data['to_driver_id']);

        try {
            $this->transfers->transfer($old, $new);
        } catch (DriverTransferRefused $e) {
            return response()->json(['message' => $e->getMessage(), 'code' => $e->reason], 422);
        }

        return response()->json(['data' => ['from_driver_id' => $old->id, 'to_driver_id' => $new->id]]);
    }

    /** @return array<string, mixed> */
    private function row(Driver $d, int $devices): array
    {
        return [
            'driver_id' => $d->id,
            'name' => $d->name,
            'uber_driver_uuid' => $d->uber_driver_uuid,
            'tenant_id' => $d->tenant_id,
            'tenant_name' => $d->tenant?->name,
            'tenant_usable' => $d->tenant?->isUsable() ?? false,
            'email' => $d->email,
            'activated_at' => $d->activated_at?->toIso8601String(),
            'roster_removed_at' => $d->roster_removed_at?->toIso8601String(),
            'roster_synced_at' => $d->roster_synced_at?->toIso8601String(),
            'device_count' => $devices,
            // Would the automatic path take the account FROM this row (holds an account and is abandoned)?
            'qualifies_as_source' => $this->transfers->hasAccount($d) && $this->transfers->isAbandoned($d),
            // Could an account be moved ONTO this row (no email and never activated)?
            'qualifies_as_target' => blank($d->email) && $d->activated_at === null,
        ];
    }
}
