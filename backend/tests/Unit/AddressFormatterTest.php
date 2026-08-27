<?php

namespace Tests\Unit;

use App\Domain\Dispatch\AddressFormatter;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class AddressFormatterTest extends TestCase
{
    #[Test]
    public function it_scores_completeness_by_present_parts(): void
    {
        // street + house-no + PLZ + city = full
        $this->assertSame(5, AddressFormatter::completeness('Sandstraße 10, 42655 Solingen'));
        // PLZ + city only (street-less station pickup)
        $this->assertSame(2, AddressFormatter::completeness('42697 Solingen'));
        // street + house-no only (no town)
        $this->assertSame(3, AddressFormatter::completeness('Sandstrasse 10'));
        $this->assertSame(0, AddressFormatter::completeness(''));
    }

    #[Test]
    public function it_prefers_the_geocoder_label_when_uber_text_is_street_less(): void
    {
        // Problem 1: Uber sent only "42697 Solingen"; the geocoder resolved the
        // station — show the station's real address.
        $display = AddressFormatter::canonical('42697 Solingen, Deutschland', [
            'address' => 'Solingen Hauptbahnhof, 42697 Solingen',
            'confidence' => 'area',
        ]);

        $this->assertSame('Solingen Hauptbahnhof, 42697 Solingen', $display);
    }

    #[Test]
    public function it_fills_town_when_uber_text_is_street_only(): void
    {
        // Problem 2: Uber sent only "Sandstrasse 10"; the geocoder filled the
        // town + PLZ — show the complete address.
        $display = AddressFormatter::canonical('Sandstrasse 10', [
            'address' => 'Sandstraße 10, 42655 Solingen',
            'confidence' => 'street',
        ]);

        $this->assertSame('Sandstraße 10, 42655 Solingen', $display);
    }

    #[Test]
    public function it_keeps_uber_text_when_the_geocoder_is_less_complete(): void
    {
        // Uber already had the full address; a weaker geocoder hit must not
        // downgrade it to a bare town.
        $display = AddressFormatter::canonical('Wilhelmshöhe 16, 47058 Duisburg', [
            'address' => '47058 Duisburg',
            'confidence' => 'postal',
        ]);

        $this->assertSame('Wilhelmshöhe 16, 47058 Duisburg', $display);
    }

    #[Test]
    public function it_replaces_a_non_latin_original_wholesale(): void
    {
        $display = AddressFormatter::canonical('شارع ما, 42655 Solingen', [
            'address' => 'Sandstraße 10, 42655 Solingen',
            'confidence' => 'exact',
        ]);

        $this->assertSame('Sandstraße 10, 42655 Solingen', $display);
    }

    #[Test]
    public function it_strips_country_tail_and_collapses_noise(): void
    {
        $this->assertSame('Sandstraße 10, 42655 Solingen', AddressFormatter::tidy('Sandstraße 10,  42655 Solingen, Deutschland'));
        $this->assertNull(AddressFormatter::tidy('  '));
    }

    #[Test]
    public function it_assembles_canonical_form_from_parts(): void
    {
        $this->assertSame('Sandstraße 10, 42655 Solingen', AddressFormatter::format('Sandstraße 10', '42655', 'Solingen'));
        $this->assertSame('42697 Solingen', AddressFormatter::format(null, '42697', 'Solingen'));
        $this->assertSame('Sandstraße 10', AddressFormatter::format('Sandstraße 10', null, null));
    }
}
