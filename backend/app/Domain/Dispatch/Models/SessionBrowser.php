<?php

namespace App\Domain\Dispatch\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;

/**
 * Health of a company's persistent Uber-session browser, as reported by the
 * browser service. Platform telemetry (super-admin only), so it is not
 * tenant-scoped — like FleetSessionOutage.
 */
class SessionBrowser extends Model
{
    public const STATE_NOT_SET_UP = 'not_set_up';

    public const STATE_LOGGING_IN = 'logging_in';

    public const STATE_ACTIVE = 'active';

    public const STATE_NEEDS_OTP = 'needs_otp';

    public const STATE_DOWN = 'down';

    public const STATES = [
        self::STATE_NOT_SET_UP, self::STATE_LOGGING_IN, self::STATE_ACTIVE, self::STATE_NEEDS_OTP, self::STATE_DOWN,
    ];

    /** The service reports on a short cycle; silence beyond this means it is gone. */
    private const LIVE_WINDOW_MINUTES = 2;

    protected $fillable = [
        'tenant_id', 'state', 'last_login_at', 'last_capture_at', 'last_seen_at',
        'hard_reauth_count', 'consecutive_errors',
    ];

    protected $casts = [
        'last_login_at' => 'datetime',
        'last_capture_at' => 'datetime',
        'last_seen_at' => 'datetime',
        'hard_reauth_count' => 'integer',
        'consecutive_errors' => 'integer',
    ];

    public function isLive(?CarbonImmutable $now = null): bool
    {
        $now ??= CarbonImmutable::now();

        return $this->last_seen_at !== null
            && $this->last_seen_at->greaterThanOrEqualTo($now->subMinutes(self::LIVE_WINDOW_MINUTES));
    }
}
