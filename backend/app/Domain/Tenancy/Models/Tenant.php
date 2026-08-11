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
     * disable and a ban are terminal; a never-activated company (fresh signup)
     * and an expired subscription are both recoverable by entering an activation
     * code.
     *
     * @return 'disabled'|'banned'|'inactive'|'expired'|null
     */
    public function stateReason(): ?string
    {
        if ($this->status !== 'active') {
            return 'disabled';
        }
        if ($this->banned_at !== null) {
            return 'banned';
        }
        // Never activated (a fresh signup) — must enter an admin code to start.
        if ($this->activated_at === null && $this->subscription_ends_at === null) {
            return 'inactive';
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
