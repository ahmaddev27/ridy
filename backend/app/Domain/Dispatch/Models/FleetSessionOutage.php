<?php

namespace App\Domain\Dispatch\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;

/**
 * A period in which a company's Uber session was rejected and no offers flowed.
 * Platform-level telemetry (super-admin only), so it is not tenant-scoped.
 */
class FleetSessionOutage extends Model
{
    public const VIA_AUTO = 'auto';

    public const VIA_MANUAL = 'manual';

    public const VIA_PAGE = 'page';

    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'uber_fleet_session_id', 'started_at', 'ended_at', 'cause', 'recovered_via', 'relink_attempts',
    ];

    protected $casts = [
        'started_at' => 'immutable_datetime',
        'ended_at' => 'immutable_datetime',
        'relink_attempts' => 'integer',
    ];

    /** Length in seconds; an open outage counts up to now. */
    public function durationSeconds(?CarbonImmutable $now = null): int
    {
        $end = $this->ended_at ?? $now ?? CarbonImmutable::now();

        return max(0, (int) $this->started_at->diffInSeconds($end, true));
    }
}
