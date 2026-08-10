<?php

namespace App\Domain\Fleet\Models;

use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Driver extends Model
{
    use BelongsToTenant;

    /**
     * Substrings of Uber's raw `driverStatus` that mean the driver is available
     * to receive dispatch. Uber returns a redacted enum over the API, so we match
     * the known families defensively rather than a single exact string.
     */
    private const ONLINE_TOKENS = ['ONLINE', 'ON_TRIP', 'EN_ROUTE', 'DISPATCHED', 'ACTIVE'];

    /** Substrings that force offline even if an online token is also present. */
    private const OFFLINE_TOKENS = ['OFFLINE', 'UNAVAILABLE', 'DISCONNECTED'];

    /**
     * Statuses are refreshed on-demand (when a manager opens the roster), so we
     * allow a generous window before a last-known "online" is treated as stale.
     */
    private const ONLINE_FRESH_MINUTES = 30;

    protected $fillable = [
        'tenant_id', 'name', 'phone', 'license_no', 'employment_type', 'external_ids', 'pseudonym_id',
        'uber_driver_uuid', 'uber_email', 'uber_link_method',
        'uber_picture_url', 'uber_rating', 'uber_total_trips', 'uber_status', 'roster_synced_at',
        'online_status', 'location_updated_at', 'status_synced_at',
    ];

    protected $casts = [
        'external_ids' => 'array',
        'uber_rating' => 'decimal:2',
        'uber_total_trips' => 'integer',
        'roster_synced_at' => 'datetime',
        'location_updated_at' => 'datetime',
        'status_synced_at' => 'datetime',
    ];

    /** True when Uber's live driverStatus reads as online / on a trip and is fresh. */
    public function isOnline(): bool
    {
        if (! $this->hasFreshStatus()) {
            return false;
        }

        $s = strtoupper((string) $this->online_status);
        foreach (self::OFFLINE_TOKENS as $token) {
            if (str_contains($s, $token)) {
                return false;
            }
        }
        foreach (self::ONLINE_TOKENS as $token) {
            if (str_contains($s, $token)) {
                return true;
            }
        }

        return false;
    }

    /** A last-known status is only trusted for a bounded window (on-demand sync). */
    private function hasFreshStatus(): bool
    {
        return $this->status_synced_at !== null
            && $this->status_synced_at->gt(now()->subMinutes(self::ONLINE_FRESH_MINUTES));
    }

    /** Drivers Uber currently reports as online — mirrors {@see isOnline()} in SQL. */
    public function scopeOnline(Builder $query): Builder
    {
        return $query
            ->whereNotNull('online_status')
            ->where('status_synced_at', '>=', now()->subMinutes(self::ONLINE_FRESH_MINUTES))
            ->where(function (Builder $q) {
                foreach (self::ONLINE_TOKENS as $token) {
                    $q->orWhere('online_status', 'like', "%{$token}%");
                }
            })
            ->where(function (Builder $q) {
                foreach (self::OFFLINE_TOKENS as $token) {
                    $q->where('online_status', 'not like', "%{$token}%");
                }
            });
    }

    protected static function booted(): void
    {
        // Assign a stable pseudonym used in analytics so driver identity is not exposed.
        static::creating(function (Driver $driver) {
            if (empty($driver->pseudonym_id)) {
                $driver->pseudonym_id = 'DRV-'.strtoupper(Str::random(6));
            }
        });
    }
}
