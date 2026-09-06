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
 * @property array<string, string>|null $labels
 * @property array<int, array{heading: ?string, lines: array<int, array{label: ?string, value: ?string}>}>|null $footer_blocks
 */
class InvoiceSettings extends Model
{
    /** The fixed primary key of the singleton row. */
    private const SINGLETON_ID = 1;

    /**
     * The built-in German heading defaults. A `labels` override falls back to
     * these, so an untouched install renders exactly as before. Keep these EXACT.
     *
     * @var array<string, string>
     */
    private const LABEL_DEFAULTS = [
        'bill_to' => 'Rechnung an',
        'invoice_date' => 'Rechnungsdatum',
        'period' => 'Leistungszeitraum',
        'activation_code' => 'Aktivierungscode',
        'customer_no' => 'Kunden-Nr.',
        'invoice_no' => 'Rechnungs-Nr.',
        'description' => 'Beschreibung',
        'qty' => 'Menge',
        'unit_price' => 'Einzelpreis',
        'amount' => 'Betrag',
        'subtotal' => 'Zwischensumme (netto)',
        'total' => 'Gesamtbetrag',
        'paid' => 'Bezahlt',
        'paid_at' => 'Bezahlt am',
        'payment_method' => 'Zahlungsart',
        'sold_by' => 'Vermittelt von',
        'contact' => 'Kontakt',
        'tax_bank' => 'Steuer & Bank',
    ];

    protected $fillable = [
        'issuer_name', 'issuer_address', 'issuer_tax_id', 'issuer_email',
        'issuer_phone', 'issuer_website', 'bank_iban', 'bank_bic', 'bank_name',
        'logo_url', 'accent_color', 'invoice_title', 'number_prefix', 'vat_rate',
        'kleinunternehmer', 'currency', 'header_note', 'footer_thanks', 'footer_terms',
        'labels', 'footer_blocks',
    ];

    protected $casts = [
        'vat_rate' => 'decimal:2',
        'kleinunternehmer' => 'boolean',
        'labels' => 'array',
        'footer_blocks' => 'array',
    ];

    /**
     * The heading for a given key: the admin's override when set & non-empty,
     * otherwise the built-in German default.
     */
    public function label(string $key): string
    {
        $override = data_get($this->labels, $key);

        if (is_string($override) && trim($override) !== '') {
            return $override;
        }

        return self::LABEL_DEFAULTS[$key] ?? '';
    }

    /**
     * The footer fine-print columns. A saved, non-empty `footer_blocks` array
     * wins; otherwise the current 3 default columns are derived from the issuer/
     * bank fields, so an install that never edited them looks identical to before.
     *
     * @return array<int, array{heading: string, lines: array<int, array{label: ?string, value: string}>}>
     */
    public function footerBlocks(): array
    {
        if (is_array($this->footer_blocks) && $this->footer_blocks !== []) {
            return $this->normalizeBlocks($this->footer_blocks);
        }

        return $this->normalizeBlocks($this->defaultFooterBlocks());
    }

    /**
     * Drop empty lines (no value) and empty blocks (no heading and no lines),
     * so a partially-filled block never renders an orphan heading.
     *
     * @param  array<int, mixed>  $blocks
     * @return array<int, array{heading: string, lines: array<int, array{label: ?string, value: string}>}>
     */
    private function normalizeBlocks(array $blocks): array
    {
        $result = [];

        foreach ($blocks as $block) {
            $heading = trim((string) data_get($block, 'heading', ''));
            $lines = [];

            foreach ((array) data_get($block, 'lines', []) as $line) {
                $value = trim((string) data_get($line, 'value', ''));
                if ($value === '') {
                    continue;
                }
                $label = data_get($line, 'label');
                $lines[] = [
                    'label' => is_string($label) && trim($label) !== '' ? trim($label) : null,
                    'value' => $value,
                ];
            }

            if ($heading === '' && $lines === []) {
                continue;
            }

            $result[] = ['heading' => $heading, 'lines' => $lines];
        }

        return $result;
    }

    /**
     * The legacy 3-column footer derived from the flat issuer/bank fields, used
     * when no custom `footer_blocks` are saved.
     *
     * @return array<int, array{heading: string, lines: array<int, array{label: ?string, value: string}>}>
     */
    private function defaultFooterBlocks(): array
    {
        $issuerLines = [];
        if (trim((string) $this->issuer_address) !== '') {
            $issuerLines[] = ['label' => null, 'value' => $this->issuer_address];
        }

        $kontaktLines = [];
        foreach ([$this->issuer_email, $this->issuer_website, $this->issuer_phone] as $value) {
            if (trim((string) $value) !== '') {
                $kontaktLines[] = ['label' => null, 'value' => (string) $value];
            }
        }

        $bankLines = [];
        if (trim((string) $this->issuer_tax_id) !== '') {
            $bankLines[] = ['label' => 'USt-IdNr.', 'value' => $this->issuer_tax_id];
        }
        if (trim((string) $this->bank_name) !== '') {
            $bankLines[] = ['label' => null, 'value' => $this->bank_name];
        }
        if (trim((string) $this->bank_iban) !== '') {
            $bankLines[] = ['label' => 'IBAN', 'value' => $this->bank_iban];
        }
        if (trim((string) $this->bank_bic) !== '') {
            $bankLines[] = ['label' => 'BIC', 'value' => $this->bank_bic];
        }

        return [
            ['heading' => (string) $this->issuer_name, 'lines' => $issuerLines],
            ['heading' => $this->label('contact'), 'lines' => $kontaktLines],
            ['heading' => $this->label('tax_bank'), 'lines' => $bankLines],
        ];
    }

    /** The singleton settings row, created with sensible defaults if missing. */
    public static function current(): self
    {
        return static::firstOrCreate(
            ['id' => self::SINGLETON_ID],
            [
                'issuer_name' => 'Reidey GmbH',
                'issuer_address' => "Friedrich-Ebert-Straße 8\n42103 Wuppertal\nDeutschland",
                // Tax ID + bank details are left blank on a fresh install — a real
                // invoice needs the real values, and a placeholder VAT/IBAN is worse
                // than none. The super-admin fills them in the template editor.
                'issuer_email' => 'billing@reidey.de',
                'issuer_website' => 'reidey.de',
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
