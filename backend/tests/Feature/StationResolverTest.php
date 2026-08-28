<?php

namespace Tests\Feature;

use App\Domain\Geo\Models\RailwayStation;
use App\Domain\Geo\StationResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class StationResolverTest extends TestCase
{
    use RefreshDatabase;

    private function station(array $attrs): RailwayStation
    {
        return RailwayStation::create(array_merge([
            'dhid' => 'dhid:'.uniqid(),
            'name' => 'Test Bahnhof',
            'source' => 'DB InfraGO OpenStation',
        ], $attrs));
    }

    private function berlinHbf(): void
    {
        $this->station([
            'name' => 'Berlin Hauptbahnhof',
            'street_line' => 'Europaplatz 1', 'street' => 'Europaplatz', 'house_number' => '1',
            'postal_code' => '10557', 'city' => 'Berlin', 'normalized_city' => RailwayStation::normalizeCity('Berlin'),
            'latitude' => 52.525589, 'longitude' => 13.369545,
        ]);
    }

    #[Test]
    public function it_resolves_a_street_less_pickup_to_the_station_address(): void
    {
        $this->berlinHbf();

        $r = (new StationResolver)->resolve('10557 Berlin');

        $this->assertNotNull($r);
        $this->assertSame('Berlin Hauptbahnhof', $r['station_name']);
        $this->assertSame('Europaplatz 1, 10557 Berlin', $r['formatted_address']);
        $this->assertSame('Europaplatz', $r['street']);
        $this->assertSame('1', $r['house_number']);
    }

    #[Test]
    public function it_leaves_an_address_that_already_has_a_street_untouched(): void
    {
        $this->berlinHbf();

        $this->assertNull((new StationResolver)->resolve('Friedrichstraße 12, 10557 Berlin'));
    }

    #[Test]
    public function it_never_guesses_between_two_stations_in_the_same_plz(): void
    {
        $this->station(['name' => 'Nord', 'street_line' => 'A 1', 'postal_code' => '44135', 'city' => 'Dortmund', 'normalized_city' => 'dortmund', 'latitude' => 51.52, 'longitude' => 7.46]);
        $this->station(['name' => 'Süd', 'street_line' => 'B 2', 'postal_code' => '44135', 'city' => 'Dortmund', 'normalized_city' => 'dortmund', 'latitude' => 51.50, 'longitude' => 7.47]);

        // No bias point → ambiguous → no replacement.
        $this->assertNull((new StationResolver)->resolve('44135 Dortmund'));
    }

    #[Test]
    public function it_picks_the_nearest_station_when_a_bias_point_is_given(): void
    {
        $this->station(['name' => 'Nord', 'street_line' => 'A 1', 'postal_code' => '44135', 'city' => 'Dortmund', 'normalized_city' => 'dortmund', 'latitude' => 51.52, 'longitude' => 7.46]);
        $this->station(['name' => 'Süd', 'street_line' => 'B 2', 'postal_code' => '44135', 'city' => 'Dortmund', 'normalized_city' => 'dortmund', 'latitude' => 51.50, 'longitude' => 7.47]);

        $r = (new StationResolver)->resolve('44135 Dortmund', 51.505, 7.469);

        $this->assertNotNull($r);
        $this->assertSame('Süd', $r['station_name']);
    }

    #[Test]
    public function it_folds_umlauts_so_muenchen_matches_muenchen(): void
    {
        $this->station([
            'name' => 'München Hbf', 'street_line' => 'Bahnhofplatz 2', 'street' => 'Bahnhofplatz', 'house_number' => '2',
            'postal_code' => '80335', 'city' => 'München', 'normalized_city' => RailwayStation::normalizeCity('München'),
            'latitude' => 48.140, 'longitude' => 11.558,
        ]);

        $r = (new StationResolver)->resolve('80335 Muenchen');

        $this->assertNotNull($r);
        $this->assertSame('München Hbf', $r['station_name']);
        $this->assertSame('Bahnhofplatz 2, 80335 München', $r['formatted_address']);
    }
}
