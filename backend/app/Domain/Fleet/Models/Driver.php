<?php

namespace App\Domain\Fleet\Models;

use App\Domain\Fleet\DriverInvitationService;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Str;
use Laravel\Sanctum\HasApiTokens;

/**
 * A fleet driver. Also the authenticatable identity for the mobile driver app
 * (email + password, issued a Sanctum bearer token) once invited by a manager.
 */
class Driver extends Authenticatable
{
    use BelongsToTenant, HasApiTokens, Notifiable;

    /**
     * Substrings of Uber's raw `driverStatus` that mean the driver is NOT taking
     * dispatch. Uber returns a redacted/variable enum, and offline drivers often
     * have no status at all — so "online" is defined as "has a status that is not
     * one of these", which reflects reality without hard-coding online strings.
     */
    private const OFFLINE_TOKENS = ['OFFLINE', 'UNAVAILABLE', 'DISCONNECTED', 'OFF_DUTY', 'LOGGED_OUT'];

    protected $fillable = [
        'tenant_id', 'name', 'phone', 'license_no', 'employment_type', 'external_ids', 'pseudonym_id',
        'uber_driver_uuid', 'uber_email', 'uber_link_method',
        'uber_picture_url', 'uber_rating', 'uber_total_trips', 'uber_status', 'roster_synced_at', 'roster_removed_at',
        'online_status', 'location_updated_at', 'status_synced_at',
        'latitude', 'longitude', 'heading', 'trip_waypoints',
        'email', 'password', 'locale', 'invite_token', 'invited_at', 'activated_at', 'last_login_at', 'offers_seen_at',
    ];

    protected $hidden = ['password', 'invite_token'];

    protected $casts = [
        'external_ids' => 'array',
        'uber_rating' => 'decimal:2',
        'uber_total_trips' => 'integer',
        'roster_synced_at' => 'datetime',
        'roster_removed_at' => 'datetime',
        'location_updated_at' => 'datetime',
        'status_synced_at' => 'datetime',
        'latitude' => 'decimal:7',
        'longitude' => 'decimal:7',
        'heading' => 'decimal:2',
        'trip_waypoints' => 'array',
        'password' => 'hashed',
        'invited_at' => 'datetime',
        'activated_at' => 'datetime',
        'last_login_at' => 'datetime',
        'offers_seen_at' => 'datetime',
    ];

    /**
     * The most-recently-used installed app instance, so the manager dashboard can
     * show which phone the driver is on (model + OS). Eager-load to avoid N+1.
     */
    public function latestDeviceToken(): HasOne
    {
        return $this->hasOne(DeviceToken::class)->latestOfMany('last_used_at');
    }

    /** True once the driver has completed activation (set a password) for the app. */
    public function isActivated(): bool
    {
        return $this->activated_at !== null;
    }

    /** App onboarding state for the manager dashboard. */
    public function appStatus(): string
    {
        // A still-pending invite that outlived the link TTL reads as "expired" — the
        // manager must re-invite, since the old activation link no longer works.
        $inviteExpired = $this->activated_at === null
            && $this->invited_at !== null
            && $this->invited_at->lt(now()->subDays(DriverInvitationService::INVITE_TTL_DAYS));

        return match (true) {
            $this->activated_at !== null => 'active',
            $inviteExpired => 'invite_expired',
            $this->invited_at !== null => 'invited',
            default => 'none',
        };
    }

    /**
     * Engagement level for the app: 0 = available (online, no trip), 1 = heading
     * to pickup (EN_ROUTE), 2 = on trip (ON_TRIP). Derived from the raw status;
     * the offer lifecycle only advances an offer when a real one is attributed.
     */
    public function engagementStatus(): int
    {
        $s = strtoupper((string) $this->online_status);
        if (str_contains($s, 'ON_TRIP')) {
            return 2;
        }
        if (str_contains($s, 'EN_ROUTE')) {
            return 1;
        }

        return 0;
    }

    /** True when Uber reports a live status for the driver that isn't an offline one. */
    public function isOnline(): bool
    {
        $s = strtoupper(trim((string) $this->online_status));
        if ($s === '') {
            return false;
        }
        foreach (self::OFFLINE_TOKENS as $token) {
            if (str_contains($s, $token)) {
                return false;
            }
        }

        return true;
    }

    /** Drivers Uber currently reports as online — mirrors {@see isOnline()} in SQL. */
    public function scopeOnline(Builder $query): Builder
    {
        return $query
            ->whereNotNull('online_status')
            ->where('online_status', '!=', '')
            ->where(function (Builder $q) {
                foreach (self::OFFLINE_TOKENS as $token) {
                    $q->where('online_status', 'not like', "%{$token}%");
                }
            });
    }

    /**
     * The active fleet: excludes drivers Uber dropped from the roster
     * (roster_removed_at) or marked inactive on their side. Drivers we don't
     * source from Uber (null uber_status) count as active. Shared by the fleet
     * driver list and the dashboard driver count so both agree.
     */
    public function scopeActiveFleet(Builder $query): Builder
    {
        return $query
            ->whereNull('roster_removed_at')
            ->where(fn (Builder $q) => $q->whereNull('uber_status')->orWhere('uber_status', 'ONBOARDING_STATUS_ACTIVE'));
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
