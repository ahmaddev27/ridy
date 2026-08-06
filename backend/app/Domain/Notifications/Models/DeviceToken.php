<?php

namespace App\Domain\Notifications\Models;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeviceToken extends Model
{
    use BelongsToTenant;

    protected $fillable = ['tenant_id', 'driver_id', 'token', 'platform', 'last_used_at'];

    protected $casts = ['last_used_at' => 'datetime'];

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }
}
