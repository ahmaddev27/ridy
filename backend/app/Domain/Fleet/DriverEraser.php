<?php

namespace App\Domain\Fleet;

use App\Domain\Audit\AuditLogger;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Domain\Notifications\Models\DeviceToken;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Erases ONE driver on request (DSGVO Art. 17) — the fleet (controller) needs a
 * way to do this without wiping the whole company. Deletes the driver's row,
 * login tokens, push devices and metrics, and anonymizes their offer history
 * (the company's trip statistics survive, detached from the person).
 *
 * A driver Uber still lists on the fleet's roster is refused: the next roster
 * sync would simply recreate them. The fleet removes them in Uber first.
 */
class DriverEraser
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** @return array{offers_anonymized: int} */
    public function erase(Driver $driver): array
    {
        if ($driver->uber_driver_uuid !== null && $driver->roster_removed_at === null) {
            throw ValidationException::withMessages([
                'driver' => [__('Remove this driver from the fleet in Uber first — otherwise the next roster sync recreates them.')],
            ]);
        }

        $anonymized = DB::transaction(function () use ($driver) {
            DeviceToken::withoutGlobalScopes()->where('driver_id', $driver->id)->delete();
            $driver->tokens()->delete();
            DriverMetric::withoutGlobalScopes()->where('driver_id', $driver->id)->delete();

            $count = 0;
            DispatchOffer::withoutGlobalScopes()
                ->where('tenant_id', $driver->tenant_id)
                ->where(function ($q) use ($driver) {
                    $q->where('driver_id', $driver->id);
                    if ($driver->uber_driver_uuid !== null) {
                        $q->orWhere('driver_uuid', $driver->uber_driver_uuid);
                    }
                })
                ->select(['id', 'raw_payload'])
                ->chunkById(500, function ($offers) use (&$count) {
                    foreach ($offers as $offer) {
                        $payload = is_array($offer->raw_payload) ? $offer->raw_payload : [];
                        unset($payload['driverInfo']);
                        DispatchOffer::withoutGlobalScopes()->whereKey($offer->id)->update([
                            'driver_id' => null,
                            'driver_uuid' => '',
                            'driver_first_name' => null,
                            'driver_last_name' => null,
                            'raw_payload' => json_encode($payload),
                        ]);
                        $count++;
                    }
                });

            $driver->delete();

            return $count;
        });

        // No PII in the audit entry — only that driver #id was erased.
        $this->audit->log('driver.erased', null, ['driver_id' => $driver->id, 'offers_anonymized' => $anonymized]);

        return ['offers_anonymized' => $anonymized];
    }
}
