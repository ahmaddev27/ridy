<?php

namespace App\Domain\Dispatch\Models;

use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

/**
 * The software passkey registered on a company's Uber account (docs/31). `credential`
 * holds the PRIVATE KEY - a high-value secret that authenticates the Uber account. It is
 * encrypted at rest, hidden from serialization, and must never reach a log, an API
 * response, an audit entry or a Sentry payload.
 */
class UberPasskey extends Model
{
    use BelongsToTenant;

    public const STATUS_ACTIVE = 'active';

    public const STATUS_REVOKED = 'revoked';

    public const STATUS_FAILED = 'failed';

    protected $fillable = [
        'tenant_id', 'uber_org_uuid', 'credential_id_hash', 'credential', 'status',
        'registered_at', 'last_used_at', 'use_count', 'failure_reason',
    ];

    protected $casts = [
        'credential' => 'encrypted:array',
        'registered_at' => 'datetime',
        'last_used_at' => 'datetime',
        'use_count' => 'integer',
    ];

    protected $hidden = ['credential'];
}
