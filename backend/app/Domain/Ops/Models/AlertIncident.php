<?php

namespace App\Domain\Ops\Models;

use App\Domain\Ops\AlertService;
use Illuminate\Database\Eloquent\Model;

/**
 * A single operational incident. Open while the condition holds; resolved_at is
 * stamped when it clears. See {@see AlertService}.
 */
class AlertIncident extends Model
{
    protected $fillable = ['key', 'kind', 'title', 'opened_at', 'resolved_at'];

    protected $casts = [
        'opened_at' => 'datetime',
        'resolved_at' => 'datetime',
    ];
}
