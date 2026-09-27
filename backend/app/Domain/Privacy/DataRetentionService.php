<?php

namespace App\Domain\Privacy;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Domain\Support\Models\ContactMessage;
use App\Models\PasswordReset;
use App\Models\Registration;
use App\Support\BatchDelete;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Applies every ENABLED retention period (see {@see RetentionPolicy}); a disabled
 * policy is skipped and reported as null. Offers are anonymized, never deleted;
 * everything else is deleted in bounded batches.
 */
class DataRetentionService
{
    public function __construct(
        private readonly RetentionPolicy $policy,
        private readonly OfferAnonymizer $offers,
        private readonly DriverEraser $drivers,
    ) {}

    /** @return array<string, int|null> affected rows per policy (null = disabled) */
    public function run(bool $dryRun = false): array
    {
        $now = CarbonImmutable::now();

        return [
            'offers_anonymized' => $this->when(RetentionPolicy::OFFER_MONTHS, $now,
                fn ($cutoff) => $this->offers->olderThan($cutoff, $dryRun)),

            'driver_metrics_deleted' => $this->when(RetentionPolicy::DRIVER_METRIC_MONTHS, $now,
                fn ($cutoff) => $this->delete(fn () => DriverMetric::withoutGlobalScopes()->where('period_end', '<', $cutoff), $dryRun)),

            'removed_drivers_erased' => $this->when(RetentionPolicy::REMOVED_DRIVER_MONTHS, $now,
                fn ($cutoff) => $this->eraseRemovedDrivers($cutoff, $dryRun)),

            'contact_messages_deleted' => $this->when(RetentionPolicy::CONTACT_MONTHS, $now,
                fn ($cutoff) => $this->delete(fn () => ContactMessage::query()->where('created_at', '<', $cutoff), $dryRun)),

            'notifications_deleted' => $this->when(RetentionPolicy::NOTIFICATION_MONTHS, $now,
                fn ($cutoff) => $this->deleteNotifications($cutoff, $dryRun)),

            'auth_rows_deleted' => $this->when(RetentionPolicy::AUTH_DAYS, $now,
                fn ($cutoff) => $this->delete(fn () => PasswordReset::query()->where('otp_expires_at', '<', $cutoff), $dryRun)
                    + $this->delete(fn () => Registration::query()->where('otp_expires_at', '<', $cutoff), $dryRun)),

            'failed_jobs_deleted' => $this->when(RetentionPolicy::FAILED_JOB_DAYS, $now,
                fn ($cutoff) => $this->delete(fn () => DB::table('failed_jobs')->where('failed_at', '<', $cutoff), $dryRun)),
        ];
    }

    /** @param callable(CarbonImmutable): int $apply */
    private function when(string $key, CarbonImmutable $now, callable $apply): ?int
    {
        $cutoff = $this->policy->cutoff($key, $now);

        return $cutoff === null ? null : $apply($cutoff);
    }

    private function delete(\Closure $query, bool $dryRun): int
    {
        return $dryRun ? $query()->count() : BatchDelete::run($query, 1000);
    }

    /** Only READ notifications — an unread one is still waiting for its user. */
    private function deleteNotifications(CarbonImmutable $cutoff, bool $dryRun): int
    {
        $query = fn () => DB::table('notifications')->whereNotNull('read_at')->where('created_at', '<', $cutoff);
        if ($dryRun) {
            return $query()->count();
        }

        // Notification ids are UUIDs; delete by id in bounded batches.
        $total = 0;
        do {
            $ids = $query()->orderBy('id')->limit(1000)->pluck('id');
            $total += $ids->isEmpty() ? 0 : DB::table('notifications')->whereIn('id', $ids->all())->delete();
        } while ($ids->count() === 1000);

        return $total;
    }

    private function eraseRemovedDrivers(CarbonImmutable $cutoff, bool $dryRun): int
    {
        $query = Driver::withoutGlobalScopes()
            ->whereNotNull('roster_removed_at')
            ->where('roster_removed_at', '<', $cutoff);

        if ($dryRun) {
            return $query->count();
        }

        $erased = 0;
        foreach ($query->lazyById(100) as $driver) {
            $this->drivers->erase($driver);
            $erased++;
        }

        return $erased;
    }
}
