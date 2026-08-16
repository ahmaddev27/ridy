<?php

namespace Tests\Feature;

use App\Domain\Billing\Models\Plan;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PublicPlanTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_lists_active_plans_cheapest_first_without_auth(): void
    {
        Plan::create(['name' => 'Jährlich', 'price' => 200, 'duration_days' => 365, 'active' => true]);
        Plan::create(['name' => 'Monatlich', 'price' => 20, 'duration_days' => 30, 'active' => true]);
        Plan::create(['name' => 'Alt', 'price' => 5, 'duration_days' => 7, 'active' => false]);

        $this->getJson('/api/v1/plans')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.name', 'Monatlich')   // cheapest first
            ->assertJsonPath('data.0.price', 20)
            ->assertJsonPath('data.1.name', 'Jährlich');
    }

    public function test_inactive_plans_are_hidden(): void
    {
        Plan::create(['name' => 'Hidden', 'price' => 9, 'duration_days' => 30, 'active' => false]);

        $this->getJson('/api/v1/plans')->assertOk()->assertJsonCount(0, 'data');
    }
}
