<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\EpochTimeBackfill;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Support\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** The one-off correction of Uber epoch times stored as UTC wall-clock. */
class EpochTimeMigrationTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        app(TenantContext::class)->set($this->tenant->id);
        // RefreshDatabase already ran the migration on the empty schema: start over
        // as if it were deploying onto the rows each test inserts.
        Settings::setMany([EpochTimeBackfill::STATE_KEY => null]);
    }

    private function runMigration(): void
    {
        (require database_path('migrations/2026_09_25_300001_convert_uber_epoch_times_to_berlin_wall_clock.php'))->up();
    }

    /** @param array<string, mixed> $attrs */
    private function offer(string $uuid, array $attrs): void
    {
        DB::table('dispatch_offers')->insert($attrs + [
            'tenant_id' => $this->tenant->id, 'driver_uuid' => 'u', 'offer_uuid' => $uuid, 'raw_payload' => '[]',
            'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function requestedAt(string $uuid): string
    {
        return (string) DB::table('dispatch_offers')->where('offer_uuid', $uuid)->value('requested_at');
    }

    private function generatedAt(string $uuid): string
    {
        return (string) DB::table('dispatch_offers')->where('offer_uuid', $uuid)->value('offer_generated_at');
    }

    public function test_utc_offer_times_are_shifted_and_already_correct_rows_are_left_alone(): void
    {
        // Legacy row: summer, stored as UTC (2 h behind received_at).
        $this->offer('summer', ['received_at' => '2026-07-01 14:00:05', 'requested_at' => '2026-07-01 12:00:00', 'offer_generated_at' => '2026-07-01 12:00:03']);
        // Legacy row: winter, 1 h behind, no offer_generated_at.
        $this->offer('winter', ['received_at' => '2026-01-10 09:00:05', 'requested_at' => '2026-01-10 08:00:00', 'offer_generated_at' => null]);
        // Written by the new code (already Berlin): untouched.
        $this->offer('new', ['received_at' => '2026-07-01 14:00:05', 'requested_at' => '2026-07-01 14:00:00', 'offer_generated_at' => '2026-07-01 14:00:03']);

        $this->runMigration();
        $this->runMigration(); // idempotent

        $this->assertStringStartsWith('2026-07-01 14:00:00', $this->requestedAt('summer'));
        $this->assertStringStartsWith('2026-07-01 14:00:03', $this->generatedAt('summer'));
        $this->assertStringStartsWith('2026-01-10 09:00:00', $this->requestedAt('winter'));
        $this->assertStringStartsWith('2026-07-01 14:00:00', $this->requestedAt('new'));
    }

    public function test_scheduled_rides_are_converted_exactly_once_and_new_ones_never(): void
    {
        // Old code, a ride booked days ahead: requested_at is legitimately far back.
        $this->offer('old-reserved', ['received_at' => '2026-07-03 10:00:05', 'requested_at' => '2026-07-01 06:00:00', 'offer_generated_at' => '2026-07-03 08:00:03']);
        $this->offer('old-reserved-no-gen', ['received_at' => '2026-07-03 10:00:05', 'requested_at' => '2026-07-01 07:00:00', 'offer_generated_at' => null]);
        // New code (between `git reset` and migrate), same kind of ride — Berlin already.
        $this->offer('new-reserved', ['received_at' => '2026-07-03 10:00:05', 'requested_at' => '2026-07-01 08:00:00', 'offer_generated_at' => '2026-07-03 10:00:03']);

        $this->runMigration();
        $this->runMigration();
        $this->artisan('dispatch:convert-epoch-times')->assertSuccessful();

        $this->assertStringStartsWith('2026-07-01 08:00:00', $this->requestedAt('old-reserved'));
        $this->assertStringStartsWith('2026-07-03 10:00:03', $this->generatedAt('old-reserved'));
        $this->assertStringStartsWith('2026-07-01 09:00:00', $this->requestedAt('old-reserved-no-gen'));
        $this->assertStringStartsWith('2026-07-01 08:00:00', $this->requestedAt('new-reserved'));
    }

    public function test_the_command_catches_rows_a_rolled_back_release_wrote_after_the_migration(): void
    {
        $this->offer('before', ['received_at' => '2026-07-01 14:00:05', 'requested_at' => '2026-07-01 12:00:00', 'offer_generated_at' => '2026-07-01 12:00:03']);
        $this->runMigration();

        // After a rollback the old code writes UTC again; the new code (reservation, no
        // offer_generated_at) writes Berlin — only the former may move.
        $this->offer('rollback', ['received_at' => '2026-07-02 14:00:05', 'requested_at' => '2026-07-02 12:00:00', 'offer_generated_at' => '2026-07-02 12:00:03']);
        $this->offer('later-new', ['received_at' => '2026-07-05 14:00:05', 'requested_at' => '2026-07-02 12:00:00', 'offer_generated_at' => null]);

        $this->artisan('dispatch:convert-epoch-times')->assertSuccessful();
        $this->artisan('dispatch:convert-epoch-times')->assertSuccessful();

        $this->assertStringStartsWith('2026-07-01 14:00:00', $this->requestedAt('before'));
        $this->assertStringStartsWith('2026-07-02 14:00:00', $this->requestedAt('rollback'));
        $this->assertStringStartsWith('2026-07-02 12:00:00', $this->requestedAt('later-new'));
    }

    public function test_metric_periods_are_shifted_once_and_berlin_rows_are_left_alone(): void
    {
        $driver = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'A']);
        $other = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'B']);
        $third = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'C']);
        $row = ['tenant_id' => $this->tenant->id, 'created_at' => now(), 'updated_at' => now()];

        DB::table('driver_metrics')->insert([
            // Stale UTC row whose Berlin twin was already written by the new code.
            $row + ['driver_id' => $driver->id, 'period_start' => '2026-08-24 02:00:00', 'period_end' => '2026-08-31 02:00:00', 'earnings' => 1],
            $row + ['driver_id' => $driver->id, 'period_start' => '2026-08-24 04:00:00', 'period_end' => '2026-08-31 04:00:00', 'earnings' => 2],
            // Plain legacy row.
            $row + ['driver_id' => $other->id, 'period_start' => '2026-08-24 02:00:00', 'period_end' => '2026-08-31 02:00:00', 'earnings' => 3],
            // The old parser's no-timeRange fallback: Berlin Monday 00:00 already.
            $row + ['driver_id' => $third->id, 'period_start' => '2026-08-24 00:00:00', 'period_end' => '2026-08-26 13:12:11', 'earnings' => 4],
        ]);

        $this->runMigration();
        $this->runMigration(); // a second pass must not shift again
        $this->artisan('dispatch:convert-epoch-times')->assertSuccessful();

        $this->assertSame(1, DB::table('driver_metrics')->where('driver_id', $driver->id)->count());
        $kept = DB::table('driver_metrics')->where('driver_id', $driver->id)->first();
        $this->assertEquals(2, $kept->earnings);
        $this->assertStringStartsWith('2026-08-24 04:00:00', (string) $kept->period_start);
        $this->assertStringStartsWith('2026-08-24 04:00:00', (string) DB::table('driver_metrics')->where('driver_id', $other->id)->value('period_start'));
        $this->assertStringStartsWith('2026-08-24 00:00:00', (string) DB::table('driver_metrics')->where('driver_id', $third->id)->value('period_start'));
    }
}
