<?php

namespace App\Domain\Tenancy\Models;

use Illuminate\Database\Eloquent\Model;

class Tenant extends Model
{
    protected $fillable = ['name', 'status', 'country', 'settings', 'uber_org_uuid'];

    protected $casts = [
        'settings' => 'array',
    ];
}
