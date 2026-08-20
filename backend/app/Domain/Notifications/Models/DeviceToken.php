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

    protected $fillable = ['tenant_id', 'user_id', 'driver_id', 'token', 'platform', 'last_used_at'];

    protected $casts = ['last_used_at' => 'datetime'];

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
