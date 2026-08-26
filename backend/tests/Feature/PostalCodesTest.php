<?php

namespace Tests\Feature;

use App\Domain\Geo\PostalCodes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
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
}
