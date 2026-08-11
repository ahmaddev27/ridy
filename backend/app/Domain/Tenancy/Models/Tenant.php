<?php

namespace App\Domain\Tenancy\Models;

use Illuminate\Database\Eloquent\Model;

class Tenant extends Model
{
    protected $fillable = [
        'name', 'status', 'country', 'settings', 'uber_org_uuid', 'proxy_url',
        'activated_at', 'subscription_ends_at', 'banned_at',
    ];

    protected $casts = [
        'settings' => 'array',
        'activated_at' => 'datetime',
        'subscription_ends_at' => 'datetime',
        'banned_at' => 'datetime',
        'activation_code_expires_at' => 'datetime',
        'activation_attempts' => 'integer',
        'activation_days' => 'integer',
    ];

    // Contains proxy credentials + the activation code — never expose in responses.
    protected $hidden = ['proxy_url', 'activation_code'];

    /** Whether the company can log in and operate right now. */
    public function isUsable(): bool
    {
        return $this->stateReason() === null;
    }

    /**
     * Why the company is blocked, or null when usable. Precedence: a manual
     * disable and a ban are terminal; an expired subscription is recoverable by
     * activation.
     *
     * @return 'disabled'|'banned'|'expired'|null
     */
    public function stateReason(): ?string
    {
        if ($this->status !== 'active') {
            return 'disabled';
        }
        if ($this->banned_at !== null) {
            return 'banned';
        }
        if ($this->subscription_ends_at !== null && $this->subscription_ends_at->isPast()) {
            return 'expired';
        }

        return null;
    }

    /** Whole days left on the subscription (0 when expired; null when open-ended). */
    public function daysLeft(): ?int
    {
        if ($this->subscription_ends_at === null) {
            return null;
        }

        return max(0, (int) now()->startOfDay()->diffInDays($this->subscription_ends_at->startOfDay(), false));
    }
}
