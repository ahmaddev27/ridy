<?php

namespace App\Domain\Billing\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * The one-row invoice template (id=1) the super-admin edits. Holds the issuer
 * identity, bank details, branding and VAT posture used to render every
 * subscription invoice. Read through {@see current()} so callers never juggle
 * the singleton id.
 *
 * @property string $issuer_name
 * @property string $issuer_address
 * @property string|null $issuer_tax_id
 * @property string|null $issuer_email
 * @property string|null $issuer_phone
 * @property string|null $issuer_website
 * @property string|null $bank_iban
 * @property string|null $bank_bic
 * @property string|null $bank_name
 * @property string|null $logo_url
 * @property string $accent_color
 * @property string $invoice_title
 * @property string $number_prefix
 * @property string $vat_rate
 * @property bool $kleinunternehmer
 * @property string $currency
 * @property string|null $header_note
 * @property string $footer_thanks
 * @property string $footer_terms
 */
class InvoiceSettings extends Model
{
    /** The fixed primary key of the singleton row. */
    private const SINGLETON_ID = 1;

    protected $fillable = [
        'issuer_name', 'issuer_address', 'issuer_tax_id', 'issuer_email',
        'issuer_phone', 'issuer_website', 'bank_iban', 'bank_bic', 'bank_name',
        'logo_url', 'accent_color', 'invoice_title', 'number_prefix', 'vat_rate',
        'kleinunternehmer', 'currency', 'header_note', 'footer_thanks', 'footer_terms',
    ];

    protected $casts = [
        'vat_rate' => 'decimal:2',
        'kleinunternehmer' => 'boolean',
    ];

    /** The singleton settings row, created with sensible defaults if missing. */
    public static function current(): self
    {
        return static::firstOrCreate(
            ['id' => self::SINGLETON_ID],
            [
                'issuer_name' => 'Reidey GmbH',
                'issuer_address' => "Friedrich-Ebert-Straße 8\n42103 Wuppertal\nDeutschland",
                'issuer_tax_id' => 'DE 123 456 789',
                'issuer_email' => 'billing@reidey.de',
                'issuer_phone' => '+49 202 000 000',
                'issuer_website' => 'reidey.de',
                'bank_iban' => 'DE00 0000 0000 0000 00',
                'bank_bic' => 'WELADEDXXX',
                'bank_name' => 'Stadtsparkasse Wuppertal',
                'accent_color' => '#0e6b4e',
                'invoice_title' => 'Rechnung',
                'number_prefix' => 'RE',
                'vat_rate' => 19.00,
                'kleinunternehmer' => false,
                'currency' => 'EUR',
                'header_note' => 'Flotten-Dispatch',
                'footer_thanks' => 'Vielen Dank für Ihr Vertrauen in Reidey.',
                'footer_terms' => 'Der Betrag wurde per Aktivierungscode vollständig beglichen — diese Rechnung dient als Zahlungsbeleg. Bei Fragen zur Rechnung erreichen Sie uns unter billing@reidey.de.',
            ],
        );
    }
}
