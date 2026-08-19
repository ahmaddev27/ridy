<?php

namespace App\Domain\Dispatch\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A dispatch-daemon instance (one per box). It registers by name and heartbeats
 * on every poll; the companies it owns are the fleet sessions whose shard_id
 * points here. A shard is "live" while it is active and has heartbeated within
 * {@see self::STALE_SECONDS}; a box that dies goes stale and its companies are
 * reassigned to a live shard.
 */
class DaemonShard extends Model
{
    /** A shard unheard-from for this long is considered dead (streams not held). */
    public const STALE_SECONDS = 180;

    protected $fillable = ['name', 'label', 'active', 'last_seen_at'];

    protected $casts = [
        'active' => 'boolean',
        'last_seen_at' => 'datetime',
    ];

    public function sessions(): HasMany
    {
        return $this->hasMany(UberFleetSession::class, 'shard_id');
    }

    /** Active and heartbeating recently — safe to assign companies to. */
    public function isLive(?CarbonImmutable $now = null): bool
    {
        return $this->active
            && $this->last_seen_at !== null
            && $this->last_seen_at->isAfter(($now ?? CarbonImmutable::now())->subSeconds(self::STALE_SECONDS));
    }

    /** Scope: shards that are active and heartbeating recently. */
    public function scopeLive(Builder $query): Builder
    {
        return $query->where('active', true)
            ->where('last_seen_at', '>=', CarbonImmutable::now()->subSeconds(self::STALE_SECONDS));
    }
}
