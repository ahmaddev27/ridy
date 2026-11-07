<?php

namespace Tests\Unit;

use App\Domain\Dispatch\CityMatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** The authoritative-city definition behind the `reject_cities` Early-decline rule. */
class CityMatcherTest extends TestCase
{
    use RefreshDatabase;

    public function test_key_folds_case_umlauts_and_punctuation(): void
    {
        $this->assertSame('duesseldorf', CityMatcher::key('Düsseldorf'));
        $this->assertSame(CityMatcher::key('Düsseldorf'), CityMatcher::key('Duesseldorf'));
        $this->assertSame('ludwigshafen am rhein', CityMatcher::key('  Ludwigshafen   am Rhein '));
        $this->assertSame('strasse', CityMatcher::key('Straße'));
        $this->assertSame('mannheim neckarau', CityMatcher::key('Mannheim-Neckarau'));
        $this->assertSame('cafe', CityMatcher::key('Café'));
    }

    public function test_plz_gives_the_authoritative_city(): void
    {
        $this->assertSame('Mannheim', CityMatcher::trustedCity('Augustaanlage 1, 68165 Mannheim'));
        $this->assertSame('Dortmund', CityMatcher::trustedCity('Königswall 15, 44137 Dortmund'));
    }

    public function test_the_city_comes_from_the_plz_never_from_text(): void
    {
        // No text town at all: still the PLZ city.
        $this->assertSame('Mannheim', CityMatcher::trustedCity('Augustaanlage 1, 68165'));
    }

    public function test_untrusted_addresses_yield_null(): void
    {
        $this->assertNull(CityMatcher::trustedCity(null));
        $this->assertNull(CityMatcher::trustedCity(''));
        $this->assertNull(CityMatcher::trustedCity('Augustaanlage 1, Mannheim'), 'no PLZ');
        $this->assertNull(CityMatcher::trustedCity('Weg 1, 00001 Nirgendwo'), 'unknown PLZ');
        $this->assertNull(CityMatcher::trustedCity('Weg 1, 68165 Mannheim, 44137 Dortmund'), 'two PLZs');
        $this->assertNull(CityMatcher::trustedCity('Weg 1, 68165 Dortmund'), 'text contradicts PLZ');
    }

    public function test_the_same_plz_twice_is_still_one_plz(): void
    {
        $this->assertSame('Mannheim', CityMatcher::trustedCity('68165 Mannheim, Weg 1, 68165 Mannheim'));
    }

    public function test_a_sub_district_in_text_is_consistent_with_the_plz_city(): void
    {
        $this->assertSame('Wuppertal', CityMatcher::trustedCity('Weg 1, 42103 Wuppertal-Elberfeld'));
    }

    public function test_a_five_digit_run_inside_a_longer_number_is_not_a_plz(): void
    {
        $this->assertNull(CityMatcher::trustedCity('Weg 1, 1234567 Mannheim'));
    }
}
