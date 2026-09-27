<?php

namespace Tests\Feature;

use App\Domain\Geo\PostalCodes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PostalCodesTest extends TestCase
{
    use RefreshDatabase;

    public function test_seed_migration_populates_known_codes(): void
    {
        // The data migration imports the committed CSV, so real German codes resolve.
        $this->assertDatabaseHas('postal_codes', ['plz' => '10115']);

        $city = PostalCodes::city('10115');
        $this->assertSame('Berlin', $city);

        $centroid = PostalCodes::centroid('80331');
        $this->assertNotNull($centroid);
        // Munich sits around 48.1°N, 11.5°E — a loose sanity box.
        $this->assertGreaterThan(47.5, $centroid['lat']);
        $this->assertLessThan(48.5, $centroid['lat']);
    }

    public function test_unknown_or_malformed_code_returns_null_and_caches_the_miss(): void
    {
        Cache::flush();

        $this->assertNull(PostalCodes::city('00000'));
        $this->assertNull(PostalCodes::centroid('abc'));
        $this->assertNull(PostalCodes::normalize('123'));
        $this->assertSame('42651', PostalCodes::normalize(' 42651 '));
    }

    public function test_grid_nearest_matches_a_full_scan(): void
    {
        $rows = DB::table('postal_codes')->get(['plz', 'lat', 'lng']);
        $bruteForce = function (float $lat, float $lng) use ($rows): string {
            $best = null;
            $bestD = INF;
            foreach ($rows as $r) {
                $d = ((float) $r->lat - $lat) ** 2 + ((float) $r->lng - $lng) ** 2;
                if ($d < $bestD) {
                    $bestD = $d;
                    $best = $r->plz;
                }
            }

            return (string) $best;
        };

        mt_srand(42);
        for ($i = 0; $i < 60; $i++) {
            $lat = 47.3 + mt_rand() / mt_getrandmax() * 7.7;
            $lng = 5.9 + mt_rand() / mt_getrandmax() * 9.1;
            $this->assertSame($bruteForce($lat, $lng), PostalCodes::nearest($lat, $lng)['plz'] ?? null, "point {$lat},{$lng}");
        }

        // A redacted 0,0 fix has no town.
        $this->assertNull(PostalCodes::nearest(0.0, 0.0));
    }
}
