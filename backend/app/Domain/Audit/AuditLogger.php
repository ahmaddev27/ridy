<?php

namespace App\Domain\Audit;

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;

/**
 * Records tamper-evident audit entries (access to location data, config changes).
 */
class AuditLogger
{
    public function __construct(private TenantContext $context) {}

    public function log(string $action, ?Model $subject = null, array $context = []): AuditLog
    {
        return AuditLog::create([
            'tenant_id' => $this->context->get(),
            'actor_id' => Auth::id(),
            'action' => $action,
            'subject_type' => $subject ? $subject::class : null,
            'subject_id' => $subject?->getKey(),
            'context' => $context ?: null,
            'ip' => Request::ip(),
            'created_at' => now(),
        ]);
    }
}
