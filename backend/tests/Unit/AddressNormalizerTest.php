<?php

namespace Tests\Unit;

use App\Domain\Dispatch\AddressNormalizer;
use PHPUnit\Framework\TestCase;

class AddressNormalizerTest extends TestCase
{
    public function test_strips_arabic_country_segment(): void
    {
        $this->assertSame(
            'Kleier Str 8, 45927 Wuppertal-Elberfeld',
            AddressNormalizer::clean('Kleier Str 8, 45927 Wuppertal-Elberfeld, ألمانيا'),
        );
    }

    public function test_strips_cyrillic_country_segment(): void
    {
        $this->assertSame(
            'Briller Straße 1F, 42103 Wuppertal',
            AddressNormalizer::clean('Briller Straße 1F, 42103 Wuppertal, Германия'),
        );
    }

    public function test_strips_korean_country_segment(): void
    {
        $this->assertSame(
            'Deutscher Ring 42, 42327 Wuppertal-Elberfeld-West',
            AddressNormalizer::clean('Deutscher Ring 42, 42327 Wuppertal-Elberfeld-West, 독일'),
        );
    }

    public function test_keeps_german_umlaut_address_untouched(): void
    {
        $address = 'Königsallee 12, 40212 Düsseldorf';
        $this->assertSame($address, AddressNormalizer::clean($address));
    }

    public function test_null_stays_null(): void
    {
        $this->assertNull(AddressNormalizer::clean(null));
    }

    public function test_all_non_latin_falls_back_to_trimmed_original(): void
    {
        $this->assertSame('العنوان', AddressNormalizer::clean('  العنوان  '));
    }
}
