<?php

namespace Tests\Unit;

use App\Domain\Dispatch\AddressNormalizer;
use PHPUnit\Framework\TestCase;

class AddressParseTest extends TestCase
{
    public function test_splits_street_plz_and_city(): void
    {
        $p = AddressNormalizer::parse('Horather Straße 183, 42111 Wuppertal');
        $this->assertSame('Horather Straße 183', $p['street']);
        $this->assertSame('42111', $p['plz']);
        $this->assertSame('Wuppertal', $p['city']);
    }

    public function test_drops_a_parenthetical_note_but_keeps_hyphenated_towns(): void
    {
        $p = AddressNormalizer::parse('42799 Leichlingen (Rheinland)');
        $this->assertNull($p['street']);
        $this->assertSame('42799', $p['plz']);
        $this->assertSame('Leichlingen', $p['city']);

        // Real hyphenated town names must survive intact.
        $p2 = AddressNormalizer::parse('Moerser Str. 1, 47475 Kamp-Lintfort');
        $this->assertSame('Kamp-Lintfort', $p2['city']);
    }

    public function test_no_postcode_yields_street_only(): void
    {
        $p = AddressNormalizer::parse('Hauptstraße 5');
        $this->assertSame('Hauptstraße 5', $p['street']);
        $this->assertNull($p['plz']);
        $this->assertNull($p['city']);
    }

    public function test_empty_input_is_all_null(): void
    {
        $p = AddressNormalizer::parse(null);
        $this->assertNull($p['street']);
        $this->assertNull($p['plz']);
        $this->assertNull($p['city']);
    }
}
