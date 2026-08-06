<?php

namespace App\Domain\Audit\Models;

use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'actor_id', 'action', 'subject_type', 'subject_id', 'context', 'ip', 'created_at',
    ];

    protected $casts = [
        'context' => 'array',
        'created_at' => 'datetime',
    ];
}
