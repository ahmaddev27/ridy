<?php

namespace App\Domain\Tenancy\Concerns;

use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Domain\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Apply to any tenant-owned model. Adds the global scope and auto-fills
 * tenant_id from the active TenantContext on creation.
 */
trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        static::addGlobalScope(new TenantScope);

        static::creating(function ($model) {
            if (empty($model->tenant_id)) {
                $context = app(TenantContext::class);

                if ($context->has()) {
                    $model->tenant_id = $context->get();
                }
            }
        });
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }
}
