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

    /** How long a fresh, not-yet-proven capture holds its org against others. */
    public const UNVERIFIED_CLAIM_MINUTES = 15;

    protected $fillable = [
        'tenant_id', 'uber_org_uuid', 'cookies', 'supplier_cookies', 'expires_at', 'status', 'last_event_at',
        'verified_at', 'jar_version',
    ];

    protected $casts = [
        'cookies' => 'encrypted:array',
        'supplier_cookies' => 'encrypted:array',
        'expires_at' => 'datetime',
        'last_event_at' => 'datetime',
        'verified_at' => 'datetime',
        'jar_version' => 'integer',
    ];

    protected $hidden = ['cookies', 'supplier_cookies'];

    /**
     * Whether this session's claim on its Uber org blocks another company from
     * connecting the same org: proven (the daemon read the org with these cookies),
     * or active and fresh enough that its first proof is still on the way. An
     * unproven claim that broke or went quiet never blocks the real owner.
     */
    public function holdsOrgClaim(?CarbonImmutable $now = null): bool
    {
        $now ??= CarbonImmutable::now();

        if ($this->verified_at !== null) {
            return true;
        }

        return $this->status === self::STATUS_ACTIVE
            && (($this->updated_at !== null && $this->updated_at->isAfter($now->subMinutes(self::UNVERIFIED_CLAIM_MINUTES)))
                || ($this->last_event_at !== null && $this->last_event_at->isAfter($now->subHour())));
    }

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
