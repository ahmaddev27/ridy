<?php

namespace Tests\Unit;

use App\Support\FleetDay;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;
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

    public function test_free_text_dates_are_a_validation_error_not_a_500(): void
    {
        foreach (['abc', 'tomorrow', '2026-13-45', '20.08.2026'] as $bad) {
            try {
                FleetDay::startOfDate($bad);
                $this->fail("'{$bad}' should be rejected");
            } catch (ValidationException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_an_offset_timestamp_is_judged_in_berlin_time(): void
    {
        // 23:30 UTC on the 19th is 01:30 Berlin on the 20th → its date label is the 20th.
        $start = FleetDay::startOfDate('2026-08-19T23:30:00Z');

        $this->assertSame('Europe/Berlin', $start->getTimezone()->getName());
        $this->assertSame('2026-08-20 04:00:00', $start->format('Y-m-d H:i:s'));
    }
}
