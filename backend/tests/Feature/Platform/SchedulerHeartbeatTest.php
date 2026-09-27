<?php

namespace Tests\Feature\Platform;

use App\Domain\System\InfrastructureHealthService;
use Illuminate\Support\Facades\Cache;
use ReflectionMethod;
use Tests\TestCase;

class SchedulerHeartbeatTest extends TestCase
{
    /** @return array{last_run_at: string|null, seconds_since: int|null, status: string} */
    private function scheduler(): array
    {
        $method = new ReflectionMethod(InfrastructureHealthService::class, 'scheduler');

        return $method->invoke(app(InfrastructureHealthService::class));
    }

    public function test_a_five_minute_old_heartbeat_is_down(): void
    {
        Cache::put(InfrastructureHealthService::HEARTBEAT_KEY, now()->subMinutes(5)->toIso8601String(), 3600);

        $s = $this->scheduler();

        $this->assertSame('down', $s['status']);
        $this->assertEqualsWithDelta(300, $s['seconds_since'], 5);
    }

    public function test_a_fresh_heartbeat_is_ok(): void
    {
        Cache::put(InfrastructureHealthService::HEARTBEAT_KEY, now()->subSeconds(30)->toIso8601String(), 3600);

        $s = $this->scheduler();

        $this->assertSame('ok', $s['status']);
        $this->assertEqualsWithDelta(30, $s['seconds_since'], 5);
    }
}
