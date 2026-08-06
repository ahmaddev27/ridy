<?php

namespace App\Domain\Dispatch\Models;

use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;

/**
 * A captured Uber fleet browser session that the dispatch daemon uses to hold
 * the live RAMEN offer stream. The cookie jar is encrypted at rest.
 */
class UberFleetSession extends Model
{
    use BelongsToTenant;

    public const STATUS_ACTIVE = 'active';

    public const STATUS_EXPIRED = 'expired';

    public const STATUS_NEEDS_RELINK = 'needs_relink';

    protected $fillable = [
        'tenant_id', 'uber_org_uuid', 'cookies', 'expires_at', 'status', 'last_event_at',
    ];

    protected $casts = [
        'cookies' => 'encrypted:array',
        'expires_at' => 'datetime',
        'last_event_at' => 'datetime',
    ];

    protected $hidden = ['cookies'];

    /**
     * A session with no cookies or a passed expiry can no longer hold the stream.
     */
    public function isUsable(?CarbonImmutable $now = null): bool
    {
        if ($this->status !== self::STATUS_ACTIVE) {
            return false;
        }

        if ($this->expires_at !== null && $this->expires_at->isBefore($now ?? CarbonImmutable::now())) {
            return false;
        }

        return true;
    }
}
