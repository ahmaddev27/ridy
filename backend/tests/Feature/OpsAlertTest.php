<?php

namespace Tests\Feature;

use App\Domain\Ops\AlertService;
use App\Domain\Ops\Models\AlertIncident;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Operational alerts de-dupe on a UNIQUE key, so re-opening an incident that
 * already resolved must reuse its row — inserting a second one threw
 * UniqueConstraintViolationException and crashed the whole alerts:check run
 * (swallowing the alert and blinding every later check).
 */
class OpsAlertTest extends TestCase
{
    use RefreshDatabase;

    public function test_reopening_a_resolved_incident_reuses_the_row(): void
    {
        $alerts = app(AlertService::class);

        $alerts->open('session_relink:24', 'session_relink', 'Uber session broken');
        $alerts->resolve('session_relink:24');
        $this->assertNotNull(AlertIncident::where('key', 'session_relink:24')->value('resolved_at'));

        // The second break must NOT throw and must NOT create a duplicate row.
        $alerts->open('session_relink:24', 'session_relink', 'Uber session broken again');

        $rows = AlertIncident::where('key', 'session_relink:24')->get();
        $this->assertCount(1, $rows);
        $this->assertNull($rows->first()->resolved_at, 'the reopened incident is open again');
        $this->assertSame('Uber session broken again', $rows->first()->title);
    }

    public function test_open_is_idempotent_while_already_open(): void
    {
        $alerts = app(AlertService::class);

        $alerts->open('shard_down:1', 'shard_down', 'Shard down');
        $opened = AlertIncident::where('key', 'shard_down:1')->value('opened_at');

        $alerts->open('shard_down:1', 'shard_down', 'Shard down');

        $this->assertCount(1, AlertIncident::where('key', 'shard_down:1')->get());
        $this->assertEquals($opened, AlertIncident::where('key', 'shard_down:1')->value('opened_at'));
    }
}
