<?php

namespace App\Domain\Notifications\Models;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeviceToken extends Model
{
    use BelongsToTenant;

    protected $fillable = ['tenant_id', 'user_id', 'driver_id', 'token', 'platform', 'device_name', 'os_version', 'last_used_at'];

    protected $casts = ['last_used_at' => 'datetime'];

    /**
     * Human device label for the manager dashboard, e.g. "Pixel 7 · Android 14".
     * Falls back gracefully when only one of model / OS version was captured, and
     * is null for legacy registrations that carried neither.
     */
    public function label(): ?string
    {
        $os = $this->platform === 'ios' ? 'iOS' : 'Android';
        $osPart = $this->os_version !== null ? "{$os} {$this->os_version}" : null;

        if ($this->device_name !== null && $osPart !== null) {
            return "{$this->device_name} · {$osPart}";
        }

        return $this->device_name ?? $osPart;
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /** The fleet owner/manager this device belongs to (owner-mode registrations). */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
