<?php

namespace Tests\Unit;

use App\Domain\Dispatch\TripGeocoder;
use ReflectionMethod;
use Tests\TestCase;

/**
 * Guards the address-tail normalization: the postcode/city must be completed on
 * the LOCATION tail only, never spliced into a street whose name contains the
 * city (the "Berliner Straße" corruption).
 */
class EnsureCityTest extends TestCase
{
    private function ensureCity(string $original, ?string $label): string
    {
        $geocoder = app(TripGeocoder::class);
        $m = new ReflectionMethod($geocoder, 'ensureCity');
        $m->setAccessible(true);

        return $m->invoke($geocoder, $original, $label);
    }

    public function test_city_inside_a_street_name_is_not_corrupted(): void
    {
        // "Berliner"/"Frankfurter" contain the city — the PLZ must go on the tail.
        $this->assertSame(
            'Berliner Straße 12, 10115 Berlin',
            $this->ensureCity('Berliner Straße 12, 10115', '10115 Berlin'),
        );
        $this->assertSame(
            'Frankfurter Allee 3, 10247 Berlin',
            $this->ensureCity('Frankfurter Allee 3, Berlin', '10247 Berlin'),
        );
    }

    public function test_fills_the_missing_half_and_leaves_complete_addresses(): void
    {
        $this->assertSame(
            'Hauptstraße 5, 42117 Wuppertal',
            $this->ensureCity('Hauptstraße 5', '42117 Wuppertal'),
        );
        $this->assertSame(
            'Bismarckstr. 42, 42117 Wuppertal',
            $this->ensureCity('Bismarckstr. 42, 42117', '42117 Wuppertal'),
        );
        // Already complete → untouched (no duplication).
        $this->assertSame(
            'Hauptstraße 5, 42117 Wuppertal',
            $this->ensureCity('Hauptstraße 5, 42117 Wuppertal', '42117 Wuppertal'),
        );
    }
}
