<?php

namespace App\Domain\Privacy;

use App\Support\Settings;
use Carbon\CarbonImmutable;

/**
 * The platform's data-retention periods (DSGVO Art. 5(1)(e) storage limitation),
 * read from the super-admin platform settings.
 *
 * Every period is OFF until the owner sets it: an empty / zero value means "keep
 * forever", so deploying this changes nothing on its own. The fleet is the
 * controller of its data; these are the processor-side defaults the owner picks.
 */
final class RetentionPolicy
{
    /** Offers older than this are anonymized (rider name, addresses, coordinates, raw payload). */
    public const OFFER_MONTHS = 'retention_offer_months';

    /** Weekly driver earnings/performance rows older than this are deleted. */
    public const DRIVER_METRIC_MONTHS = 'retention_driver_metric_months';

    /** Drivers removed from their fleet's Uber roster this long ago are erased. */
    public const REMOVED_DRIVER_MONTHS = 'retention_removed_driver_months';

    /** Website contact messages older than this are deleted. */
    public const CONTACT_MONTHS = 'retention_contact_months';

    /** READ bell notifications older than this are deleted. */
    public const NOTIFICATION_MONTHS = 'retention_notification_months';

    /** Expired OTP rows and abandoned sign-ups older than this are deleted. */
    public const AUTH_DAYS = 'retention_auth_days';

    /** Failed queue jobs (payloads may hold emails/tokens) older than this are deleted. */
    public const FAILED_JOB_DAYS = 'retention_failed_jobs_days';

    /** @var array<int, string> every setting key, for the admin settings API */
    public const KEYS = [
        self::OFFER_MONTHS, self::DRIVER_METRIC_MONTHS, self::REMOVED_DRIVER_MONTHS,
        self::CONTACT_MONTHS, self::NOTIFICATION_MONTHS, self::AUTH_DAYS, self::FAILED_JOB_DAYS,
    ];

    /** The configured period, or null when the policy is disabled. */
    public function period(string $key): ?int
    {
        $value = (int) (Settings::get($key) ?? 0);

        return $value > 0 ? $value : null;
    }

    /** Rows older than the returned moment are due; null when the policy is disabled. */
    public function cutoff(string $key, ?CarbonImmutable $now = null): ?CarbonImmutable
    {
        $period = $this->period($key);
        if ($period === null) {
            return null;
        }

        $now ??= CarbonImmutable::now();

        return str_ends_with($key, '_days') ? $now->subDays($period) : $now->subMonthsNoOverflow($period);
    }
}
