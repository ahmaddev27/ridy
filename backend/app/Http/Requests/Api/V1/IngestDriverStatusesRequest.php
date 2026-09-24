<?php

namespace App\Http\Requests\Api\V1;

use App\Domain\Dispatch\RosterSyncService;
use Illuminate\Foundation\Http\FormRequest;

/**
 * One batch of live driver statuses (Uber GetDriverLiveLocation) — the SAME
 * contract for the daemon and the extension, so the two paths can't drift.
 *
 * Bounded, but deliberately generous: a 422 drops EVERY driver's status and
 * lifecycle transition in the batch, so the ceilings only stop abuse. The real
 * limits are applied by the ingestor, which keeps a handful of waypoints per
 * driver (they drive an OSRM route + one reverse geocode per stop on the queue).
 */
class IngestDriverStatusesRequest extends FormRequest
{
    /**
     * Uber's GetDriverLiveLocation returns EVERY org driver (offline ones too) and
     * neither the daemon nor the extension chunks the batch, so the cap must admit
     * the largest roster we accept — a lower cap 422'd every full batch of a big fleet.
     */
    public const MAX_STATUSES = RosterSyncService::MAX_DRIVERS;

    public const MAX_WAYPOINTS = 200;

    public function authorize(): bool
    {
        // Auth is the route's middleware (dispatch secret, or Sanctum + ability).
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'statuses' => ['required', 'array', 'max:'.self::MAX_STATUSES],
            'statuses.*.driver_uuid' => ['required', 'string', 'max:64'],
            'statuses.*.status' => ['nullable', 'string', 'max:100'],
            'statuses.*.location_updated_at' => ['nullable', 'numeric'], // ms epoch
            'statuses.*.latitude' => ['nullable', 'numeric'],
            'statuses.*.longitude' => ['nullable', 'numeric'],
            'statuses.*.heading' => ['nullable', 'numeric'],
            'statuses.*.waypoints' => ['nullable', 'array', 'max:'.self::MAX_WAYPOINTS],
        ];
    }
}
