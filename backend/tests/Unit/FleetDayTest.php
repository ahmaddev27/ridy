<?php

namespace Tests\Unit;

use App\Support\FleetDay;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class FleetDayTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_before_4am_belongs_to_the_previous_fleet_day(): void
    {
        Carbon::setTestNow(CarbonImmutable::parse('2026-08-20 02:30', 'Europe/Berlin'));

        $this->assertSame('2026-08-19 04:00:00', FleetDay::todayStart()->format('Y-m-d H:i:s'));
    }

    public function test_after_4am_belongs_to_the_same_calendar_day(): void
    {
        Carbon::setTestNow(CarbonImmutable::parse('2026-08-20 05:00', 'Europe/Berlin'));

        $this->assertSame('2026-08-20 04:00:00', FleetDay::todayStart()->format('Y-m-d H:i:s'));
    }

    public function test_exactly_4am_is_the_start_of_the_new_fleet_day(): void
    {
        Carbon::setTestNow(CarbonImmutable::parse('2026-08-20 04:00', 'Europe/Berlin'));

        $this->assertSame('2026-08-20 04:00:00', FleetDay::todayStart()->format('Y-m-d H:i:s'));
    }

    public function test_date_window_labels_a_calendar_date_as_04_to_next_04(): void
    {
        $this->assertSame('2026-08-20 04:00:00', FleetDay::startOfDate('2026-08-20')->format('Y-m-d H:i:s'));
        $this->assertSame('2026-08-21 04:00:00', FleetDay::endOfDate('2026-08-20')->format('Y-m-d H:i:s'));
    }
}
