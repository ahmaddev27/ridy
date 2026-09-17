<?php

namespace Tests\Feature;

use App\Support\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PublicPaymentTest extends TestCase
{
    use RefreshDatabase;

    public function test_both_methods_are_null_when_nothing_is_enabled(): void
    {
        $this->getJson('/api/v1/payment-methods')
            ->assertOk()
            ->assertJsonPath('data.bank', null)
            ->assertJsonPath('data.cash', null);
    }

    public function test_it_exposes_only_the_enabled_bank_method(): void
    {
        Settings::setMany([
            'pay_bank_enabled' => '1',
            'pay_bank_holder' => 'Reidey GmbH',
            'pay_bank_name' => 'Sparkasse',
            'pay_bank_iban' => 'DE89370400440532013000',
            'pay_bank_bic' => 'COBADEFFXXX',
            'pay_bank_note' => 'Please quote your reference.',
            // Cash filled but disabled → must stay hidden.
            'pay_cash_enabled' => '',
            'pay_cash_whatsapp' => '+491700000000',
        ]);

        $this->getJson('/api/v1/payment-methods')
            ->assertOk()
            ->assertJsonPath('data.bank.holder', 'Reidey GmbH')
            ->assertJsonPath('data.bank.iban', 'DE89370400440532013000')
            ->assertJsonPath('data.bank.bic', 'COBADEFFXXX')
            ->assertJsonPath('data.cash', null);
    }

    public function test_it_exposes_only_the_enabled_cash_method(): void
    {
        Settings::setMany([
            'pay_cash_enabled' => '1',
            'pay_cash_whatsapp' => '+491700000000',
            'pay_cash_note' => 'Call between 9 and 5.',
            // Bank filled but disabled → must stay hidden.
            'pay_bank_enabled' => '',
            'pay_bank_iban' => 'DE89370400440532013000',
        ]);

        $this->getJson('/api/v1/payment-methods')
            ->assertOk()
            ->assertJsonPath('data.cash.whatsapp', '+491700000000')
            ->assertJsonPath('data.cash.note', 'Call between 9 and 5.')
            ->assertJsonPath('data.bank', null);
    }
}
