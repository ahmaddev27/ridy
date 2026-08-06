<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TenantIsolationTest extends TestCase
{
    use RefreshDatabase;

    public function test_global_scope_isolates_tenant_data(): void
    {
        $tenantA = Tenant::create(['name' => 'A', 'country' => 'DE']);
        $tenantB = Tenant::create(['name' => 'B', 'country' => 'DE']);

        $context = app(TenantContext::class);

        // Create one driver per tenant; tenant_id is auto-filled from context.
        $context->set($tenantA->id);
        Driver::create(['name' => 'A-driver']);

        $context->set($tenantB->id);
        Driver::create(['name' => 'B-driver']);

        // As tenant A, only A's driver is visible.
        $context->set($tenantA->id);
        $visibleToA = Driver::all();
        $this->assertCount(1, $visibleToA);
        $this->assertSame('A-driver', $visibleToA->first()->name);

        // As tenant B, only B's driver is visible.
        $context->set($tenantB->id);
        $visibleToB = Driver::all();
        $this->assertCount(1, $visibleToB);
        $this->assertSame('B-driver', $visibleToB->first()->name);

        // Without scope, both exist in the table.
        $context->forget();
        $this->assertSame(2, Driver::withoutGlobalScopes()->count());
    }
}
