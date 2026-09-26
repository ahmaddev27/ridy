<?php

namespace App\Domain\Privacy;

use App\Domain\Audit\AuditLogger;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Domain\Notifications\Models\DeviceToken;
use App\Models\PasswordReset;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Erases ONE driver (DSGVO Art. 17), without touching the rest of the fleet.
 *
 * Removes the driver row and everything keyed to it — app sessions (Sanctum
 * tokens), push tokens, OTP rows, bell notifications, weekly metrics — and
 * unlinks + anonymizes their offers: the fleet keeps the trip figures for its
 * statistics, but nothing left points back at the person (driver id, Uber driver
 * uuid, captured names and the raw payload are cleared, as are the addresses and
 * coordinates of their trips).
 *
 * Used by the fleet dashboard (DELETE /drivers/{driver}), `drivers:erase` and the
 * retention job — one eraser, so every Art. 17 path removes the same data.
 *
 * Note: a driver still on the fleet's Uber roster is re-created by the next
 * roster sync — remove them in Uber first ({@see assertErasable()}).
 */
class DriverEraser
{
    /** Stored in dispatch_offers.driver_uuid (NOT NULL) once the Uber uuid is erased. */
    public const ERASED_UUID = 'erased';

    public function __construct(
        private readonly OfferAnonymizer $offers,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Refuse a driver Uber still lists on the fleet's roster: the next roster sync
     * would simply recreate them. The fleet removes them in Uber first.
     *
     * @throws ValidationException
     */
    public function assertErasable(Driver $driver): void
    {
        if ($driver->uber_driver_uuid !== null && $driver->roster_removed_at === null) {
            throw ValidationException::withMessages([
                'driver' => [__('Remove this driver from the fleet in Uber first — otherwise the next roster sync recreates them.')],
            ]);
        }
    }

    /** @return array<string, int> rows affected per entity */
    public function erase(Driver $driver): array
    {
        $driverId = (int) $driver->id;
        $tenantId = (int) $driver->tenant_id;
        $uberUuid = $driver->uber_driver_uuid;
        $email = $driver->email;

        $offers = $this->offers->run(
            fn () => DispatchOffer::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where(function ($q) use ($driverId, $uberUuid) {
                    $q->where('driver_id', $driverId);
                    if (filled($uberUuid)) {
                        $q->orWhere('driver_uuid', $uberUuid);
                    }
                }),
            extra: ['driver_id' => null, 'driver_uuid' => self::ERASED_UUID],
        );

        $counts = DB::transaction(function () use ($driver, $driverId, $email) {
            $counts = [
                'device_tokens' => DeviceToken::withoutGlobalScopes()->where('driver_id', $driverId)->delete(),
                'driver_metrics' => DriverMetric::withoutGlobalScopes()->where('driver_id', $driverId)->delete(),
                'api_tokens' => DB::table('personal_access_tokens')
                    ->where('tokenable_type', $driver->getMorphClass())->where('tokenable_id', $driverId)->delete(),
                'notifications' => DB::table('notifications')
                    ->where('notifiable_type', $driver->getMorphClass())->where('notifiable_id', $driverId)->delete(),
                'otp_rows' => filled($email) ? PasswordReset::where('email', $email)->delete() : 0,
            ];

            Driver::withoutGlobalScopes()->whereKey($driverId)->delete();

            return $counts;
        });

        $counts['offers_anonymized'] = $offers;

        // No name/email in the trail — only the ids that were erased.
        $this->audit->log('driver.erased', null, ['driver_id' => $driverId, 'counts' => $counts], $tenantId);

        return $counts;
    }
}
