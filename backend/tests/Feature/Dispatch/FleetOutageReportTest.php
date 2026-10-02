<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\Models\DispatchNetworkLog;
use App\Domain\Dispatch\Models\FleetSessionOutage;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class FleetOutageReportTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Keep the console table on one line so cell text isn't wrapped mid-word.
        putenv('COLUMNS=220');
    }

    private function report(): string
    {
        Artisan::call('fleet:outage-report');

        return Artisan::output();
    }

    public function test_it_reports_warm_sessions_and_open_outages(): void
    {
        $warm = Tenant::create(['name' => 'Warm Co', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
        $down = Tenant::create(['name' => 'Down Co', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);

        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $warm->id, 'uber_org_uuid' => 'org-warm', 'cookies' => [['name' => 'sid', 'value' => 'a']],
            'status' => UberFleetSession::STATUS_ACTIVE, 'last_event_at' => now(),
        ]);
        $downSession = UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $down->id, 'uber_org_uuid' => 'org-down', 'cookies' => [['name' => 'sid', 'value' => 'b']],
            'status' => UberFleetSession::STATUS_ACTIVE, 'last_event_at' => now(),
        ]);

        DispatchNetworkLog::create([
            'tenant_id' => $warm->id, 'kind' => 'session', 'summary' => 'x',
            'payload' => ['event' => 'cookies_refreshed', 'cookie_count' => 3],
        ]);
        FleetSessionOutage::create([
            'tenant_id' => $down->id, 'uber_fleet_session_id' => $downSession->id,
            'started_at' => now()->subHour(), 'cause' => 'daemon',
        ]);

        $out = $this->report();

        $this->assertStringContainsString('Warm Co', $out);
        $this->assertStringContainsString('Down Co', $out);
        $this->assertStringContainsString('DOWN', $out);               // the open outage
        $this->assertStringContainsString('2 active session(s)', $out);
        $this->assertStringContainsString('1 open outage(s)', $out);
    }

    public function test_it_says_so_when_there_are_no_active_sessions(): void
    {
        $this->assertStringContainsString('No active sessions.', $this->report());
    }
}
