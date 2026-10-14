<?php

namespace App\Domain\Dispatch\Models;

use App\Domain\Dispatch\DispatchCommandAction;
use App\Domain\Dispatch\DispatchCommandStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One dispatch action a driver (or a manager) asked us to send to Uber for an
 * offer — the work item and its audit trail in one row.
 *
 * The daemon holds the live vsdispatch cookie jar and the company's residential
 * proxy, so it performs the mutation; it learns about a row through a long-poll it
 * parks in advance and reports Uber's verdict back here.
 *
 * Uber's offer window is 5 seconds, so the whole mutation payload is frozen on the
 * row at queue time. The daemon is a dumb executor: no lookup, no JSON decode, and
 * nothing that can go stale while the clock runs.
 */
class OfferDispatchCommand extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id', 'dispatch_offer_id', 'uber_fleet_session_id', 'action',
        'driver_id', 'user_id',
        'offer_uuid', 'real_offer_uuid', 'offer_type', 'driver_uuid',
        'status', 'attempts', 'session_token_expired', 'uber_success', 'uber_error', 'latency_ms',
        'expires_at', 'claimed_at', 'completed_at',
    ];

    protected $casts = [
        'action' => DispatchCommandAction::class,
        'status' => DispatchCommandStatus::class,
        'attempts' => 'integer',
        'session_token_expired' => 'boolean',
        'uber_success' => 'boolean',
        'latency_ms' => 'integer',
        'expires_at' => 'datetime',
        'claimed_at' => 'datetime',
        'completed_at' => 'datetime',
    ];

    public function offer(): BelongsTo
    {
        return $this->belongsTo(DispatchOffer::class, 'dispatch_offer_id');
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Work a daemon may pick up: queued and still inside the offer's window.
     *
     * An expired row is never handed out — firing a decline Uber will refuse costs
     * a request, muddies the measurement, and tells the driver nothing useful.
     */
    public function scopeClaimable(Builder $query): Builder
    {
        return $query->where('status', DispatchCommandStatus::Queued)
            ->where('expires_at', '>', now());
    }
}
