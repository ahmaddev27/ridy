<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PruneExpiredCacheTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_deletes_only_expired_cache_rows_and_locks_in_batches(): void
    {
        $now = now()->getTimestamp();

        $rows = [];
        for ($i = 0; $i < 5; $i++) {
            $rows[] = ['key' => "expired-{$i}", 'value' => 'x', 'expiration' => $now - 60];
        }
        $rows[] = ['key' => 'live', 'value' => 'x', 'expiration' => $now + 3600];
        DB::table('cache')->insert($rows);

        DB::table('cache_locks')->insert([
            ['key' => 'old-lock', 'owner' => 'a', 'expiration' => $now - 1],
            ['key' => 'held-lock', 'owner' => 'b', 'expiration' => $now + 60],
        ]);

        $this->artisan('cache:prune-expired', ['--batch' => 2])->assertSuccessful();

        $this->assertSame(['live'], DB::table('cache')->pluck('key')->all());
        $this->assertSame(['held-lock'], DB::table('cache_locks')->pluck('key')->all());
    }
}
