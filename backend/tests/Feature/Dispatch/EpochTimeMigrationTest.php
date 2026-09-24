<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** The one-off correction of Uber epoch times stored as UTC wall-clock. */
class EpochTimeMigrationTest extends TestCase
{
    use RefreshDatabase;

    private function runMigration(): void
    {
        (require database_path('migrations/2026_09_25_300001_convert_uber_epoch_times_to_berlin_wall_clock.php'))->up();
    }

    public function test_utc_offer_times_are_shifted_and_already_correct_rows_are_left_alone(): void
    {
        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        $base = ['tenant_id' => $tenant->id, 'driver_uuid' => 'u', 'raw_payload' => '[]', 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()];

        DB::table('dispatch_offers')->insert([
            // Legacy row: summer, stored as UTC (2 h behind received_at).
            $base + ['offer_uuid' => 'summer', 'received_at' => '2026-07-01 14:00:05', 'requested_at' => '2026-07-01 12:00:00', 'offer_generated_at' => '2026-07-01 12:00:03'],
            // Legacy row: winter, 1 h behind.
            $base + ['offer_uuid' => 'winter', 'received_at' => '2026-01-10 09:00:05', 'requested_at' => '2026-01-10 08:00:00', 'offer_generated_at' => null],
            // Written by the new code (already Berlin): untouched.
            $base + ['offer_uuid' => 'new', 'received_at' => '2026-07-01 14:00:05', 'requested_at' => '2026-07-01 14:00:00', 'offer_generated_at' => '2026-07-01 14:00:03'],
        ]);

        $this->runMigration();
        $this->runMigration(); // idempotent

        $rows = DB::table('dispatch_offers')->pluck('requested_at', 'offer_uuid');
        $this->assertStringStartsWith('2026-07-01 14:00:00', $rows['summer']);
        $this->assertStringStartsWith('2026-01-10 09:00:00', $rows['winter']);
        $this->assertStringStartsWith('2026-07-01 14:00:00', $rows['new']);
        $this->assertStringStartsWith('2026-07-01 14:00:03', (string) DB::table('dispatch_offers')->where('offer_uuid', 'summer')->value('offer_generated_at'));
    }

    public function test_metric_periods_are_shifted_and_a_clash_with_a_new_row_drops_the_stale_one(): void
    {
        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        app(TenantContext::class)->set($tenant->id);
        $driver = Driver::create(['tenant_id' => $tenant->id, 'name' => 'A']);
        $other = Driver::create(['tenant_id' => $tenant->id, 'name' => 'B']);
        $row = ['tenant_id' => $tenant->id, 'created_at' => now(), 'updated_at' => now()];

        DB::table('driver_metrics')->insert([
            // Stale UTC row whose Berlin twin was already written by the new code.
            $row + ['driver_id' => $driver->id, 'period_start' => '2026-08-24 02:00:00', 'period_end' => '2026-08-31 02:00:00', 'earnings' => 1],
            $row + ['driver_id' => $driver->id, 'period_start' => '2026-08-24 04:00:00', 'period_end' => '2026-08-31 04:00:00', 'earnings' => 2],
            // Plain legacy row.
            $row + ['driver_id' => $other->id, 'period_start' => '2026-08-24 02:00:00', 'period_end' => '2026-08-31 02:00:00', 'earnings' => 3],
        ]);

        $this->runMigration();

        $this->assertSame(1, DB::table('driver_metrics')->where('driver_id', $driver->id)->count());
        $this->assertEquals(2, DB::table('driver_metrics')->where('driver_id', $driver->id)->value('earnings'));
        $this->assertStringStartsWith('2026-08-24 04:00:00', (string) DB::table('driver_metrics')->where('driver_id', $other->id)->value('period_start'));
    }
}
