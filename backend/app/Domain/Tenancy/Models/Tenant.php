<?php

namespace App\Domain\Tenancy\Models;

use Illuminate\Database\Eloquent\Model;

class Tenant extends Model
{
    protected $fillable = ['name', 'status', 'country', 'settings', 'uber_org_uuid', 'proxy_url'];

    protected $casts = [
        'settings' => 'array',
    ];

    // Contains proxy credentials — never expose it in API responses.
    protected $hidden = ['proxy_url'];
}
