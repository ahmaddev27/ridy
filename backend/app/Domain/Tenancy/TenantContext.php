<?php

namespace App\Domain\Tenancy;

/**
 * Holds the currently-active tenant id for the request/job lifecycle.
 * Bound as a singleton so the global scope and models share one source of truth.
 */
class TenantContext
{
    private ?int $tenantId = null;

    public function set(?int $tenantId): void
    {
        $this->tenantId = $tenantId;
    }

    public function get(): ?int
    {
        return $this->tenantId;
    }

    public function has(): bool
    {
        return $this->tenantId !== null;
    }

    public function forget(): void
    {
        $this->tenantId = null;
    }
}
