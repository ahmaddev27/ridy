<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\Models\DaemonShard;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\ShardService;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Daemon-shard failover and rebalance: self-healing without split brain. */
class ShardServiceTest extends TestCase
{
    use RefreshDatabase;

    private function sessions(int $n, ?int $shardId = null): void
    {
        for ($i = 0; $i < $n; $i++) {
            $tenant = Tenant::create(['name' => "T{$i}", 'country' => 'DE']);
            UberFleetSession::withoutGlobalScopes()->create([
                'tenant_id' => $tenant->id, 'uber_org_uuid' => fake()->uuid(),
                'cookies' => [['name' => 'a', 'value' => 'b']],
            ])->forceFill(['shard_id' => $shardId])->save();
        }
    }

    private function counts(): array
    {
        return UberFleetSession::withoutGlobalScopes()->get()->countBy('shard_id')->sortKeys()->all();
    }

    public function test_unassigned_companies_spread_evenly_across_live_shards(): void
    {
        $a = DaemonShard::create(['name' => 'a', 'active' => true, 'last_seen_at' => now()]);
        $b = DaemonShard::create(['name' => 'b', 'active' => true, 'last_seen_at' => now()]);
        $this->sessions(4);

        app(ShardService::class)->reconcileAssignments();

        $this->assertSame([$a->id => 2, $b->id => 2], $this->counts());
    }

    public function test_a_dead_shards_companies_fail_over_but_a_briefly_silent_one_keeps_them(): void
    {
        $live = DaemonShard::create(['name' => 'live', 'active' => true, 'last_seen_at' => now()]);
        $blip = DaemonShard::create(['name' => 'blip', 'active' => true, 'last_seen_at' => now()->subSeconds(200)]);
        $dead = DaemonShard::create(['name' => 'dead', 'active' => true, 'last_seen_at' => now()->subMinutes(10)]);
        $this->sessions(2, $blip->id);
        $this->sessions(2, $dead->id);

        app(ShardService::class)->reconcileAssignments();

        $this->assertSame([$live->id => 2, $blip->id => 2], $this->counts());
    }

    public function test_the_first_box_back_after_a_backend_outage_does_not_grab_everything(): void
    {
        $service = app(ShardService::class);
        $first = DaemonShard::create(['name' => 'first', 'active' => true, 'last_seen_at' => now()->subMinutes(10)]);
        $other = DaemonShard::create(['name' => 'other', 'active' => true, 'last_seen_at' => now()->subMinutes(10)]);
        $this->sessions(2, $first->id);
        $this->sessions(2, $other->id);

        // Both boxes were cut off from the backend; 'first' polls first.
        $service->heartbeat('first');
        $service->reconcileAssignments();

        $this->assertSame([$first->id => 2, $other->id => 2], $this->counts());
    }

    public function test_nothing_moves_when_no_shard_is_live(): void
    {
        $gone = DaemonShard::create(['name' => 'gone', 'active' => true, 'last_seen_at' => now()->subHour()]);
        $this->sessions(2, $gone->id);

        app(ShardService::class)->reconcileAssignments();

        $this->assertSame([$gone->id => 2], $this->counts());
    }

    public function test_rebalance_moves_only_the_overflow(): void
    {
        $a = DaemonShard::create(['name' => 'a', 'active' => true, 'last_seen_at' => now()]);
        $this->sessions(4, $a->id);
        $b = DaemonShard::create(['name' => 'b', 'active' => true, 'last_seen_at' => now()]);

        $result = app(ShardService::class)->rebalance();

        $this->assertSame(['moved' => 2, 'live_shards' => 2], $result);
        $this->assertSame([$a->id => 2, $b->id => 2], $this->counts());

        // Already balanced → nothing moves.
        $this->assertSame(0, app(ShardService::class)->rebalance()['moved']);
    }
}
