<?php

namespace App\Domain\Ads\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * A platform-wide promotional ad. Not tenant-scoped — the super-admin authors
 * these and every company sees the currently live one on its Offers view.
 */
class Ad extends Model
{
    protected $fillable = [
        'title',
        'body',
        'image_url',
        'image_mobile',
        'image_tablet',
        'image_desktop',
        'link_url',
        'cta_label',
        'active',
        'starts_at',
        'ends_at',
    ];

    protected $casts = [
        'active' => 'boolean',
        'starts_at' => 'datetime',
        'ends_at' => 'datetime',
    ];

    /**
     * Ads eligible to show right now: active and, when a window is set, within it.
     */
    public function scopeLive(Builder $query): Builder
    {
        $now = now();

        return $query->where('active', true)
            ->where(fn (Builder $q) => $q->whereNull('starts_at')->orWhere('starts_at', '<=', $now))
            ->where(fn (Builder $q) => $q->whereNull('ends_at')->orWhere('ends_at', '>=', $now));
    }
}
