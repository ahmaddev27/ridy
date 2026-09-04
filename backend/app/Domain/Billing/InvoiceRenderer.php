<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Models\InvoiceSettings;
use App\Domain\Billing\Models\SubscriptionPeriod;
use Barryvdh\DomPDF\Facade\Pdf;
use Barryvdh\DomPDF\PDF as DomPdf;
use Illuminate\Contracts\View\Factory as ViewFactory;

/**
 * Turns a {@see SubscriptionPeriod} into a normalized, presentation-ready view
 * model and renders it as either HTML (live preview) or a dompdf PDF (download
 * / email attachment). All money is computed in integer cents to avoid float
 * drift, then formatted de-DE ("149,00 €").
 */
class InvoiceRenderer
{
    private const VIEW = 'invoices.invoice';

    /** Currency code => symbol; falls back to the code itself when unmapped. */
    private const SYMBOLS = ['EUR' => '€', 'USD' => '$', 'GBP' => '£', 'CHF' => 'CHF'];

    public function __construct(private readonly ViewFactory $views) {}

    /** Render the invoice for a real period as an HTML string. */
    public function html(SubscriptionPeriod $period, InvoiceSettings $settings): string
    {
        return $this->views->make(self::VIEW, $this->viewData($period, $settings))->render();
    }

    /** Render the invoice for a real period as a dompdf PDF instance. */
    public function pdf(SubscriptionPeriod $period, InvoiceSettings $settings): DomPdf
    {
        return $this->pdfFromData($this->viewData($period, $settings));
    }

    /** Render arbitrary sample data as HTML (super-admin live preview). */
    public function htmlFromData(array $data): string
    {
        return $this->views->make(self::VIEW, $data)->render();
    }

    /**
     * A fixed set of realistic sample values (the approved design's example),
     * merged with the given settings, for the super-admin live preview. Money is
     * computed from a €149.00 gross example so VAT changes are visible instantly.
     *
     * @return array<string, mixed>
     */
    public function sampleData(InvoiceSettings $settings): array
    {
        $money = $this->splitMoney(149.00, (float) $settings->vat_rate, (bool) $settings->kleinunternehmer);
        $symbol = self::SYMBOLS[$settings->currency] ?? $settings->currency;

        return [
            'settings' => $settings,
            'accent' => $settings->accent_color ?: '#0e6b4e',
            'logo_url' => $settings->logo_url,
            'title' => $settings->invoice_title ?: 'Rechnung',

            'invoice_no' => $settings->number_prefix.'-'.date('Y').'-0042',
            'issue_date' => '04.09.2026',
            'period_start' => '04.09.2026',
            'period_end' => '04.10.2026',

            'customer_name' => 'Asfour Fleet GmbH',
            'customer_address' => "Elberfelder Straße 12\n42103 Wuppertal\nDeutschland",
            'customer_no' => 'KD-0071',
            'activation_code' => 'REIDEY-7F3K-92MX',

            'item_title' => 'Reidey Flotten-Abo',
            'item_desc' => 'Live-Dispatch, Fahrer-Push & Auswertung · Laufzeit 30 Tage',
            'quantity' => 1,

            'currency' => $settings->currency,
            'net' => $this->format($money['net'], $symbol),
            'vat' => $this->format($money['vat'], $symbol),
            'gross' => $this->format($money['gross'], $symbol),
            'unit_price' => $this->format($money['gross'], $symbol),
            'vat_rate' => rtrim(rtrim(number_format((float) $settings->vat_rate, 2, ',', '.'), '0'), ','),
            'kleinunternehmer' => (bool) $settings->kleinunternehmer,

            'paid' => true,
            'paid_at' => '04.09.2026',
            'payment_method' => 'Aktivierungscode',
            'sold_by' => 'Reidey Vertrieb',
        ];
    }

    /** @param array<string, mixed> $data */
    private function pdfFromData(array $data): DomPdf
    {
        return Pdf::loadView(self::VIEW, $data)
            ->setPaper('a4')
            ->setOption('isRemoteEnabled', true);
    }

    /**
     * The normalized invoice view model. Callers (controller + Blade) only see
     * finished strings and booleans — no domain objects and no money math.
     *
     * @return array<string, mixed>
     */
    private function viewData(SubscriptionPeriod $period, InvoiceSettings $settings): array
    {
        $tenant = $period->tenant;
        $code = $period->code;
        $money = $this->splitMoney($period->amount, (float) $settings->vat_rate, (bool) $settings->kleinunternehmer);
        $symbol = self::SYMBOLS[$settings->currency] ?? $settings->currency;

        $planName = $code?->plan?->name;
        $soldBy = $code?->collector?->name;

        return [
            'settings' => $settings,
            'accent' => $settings->accent_color ?: '#0e6b4e',
            'logo_url' => $settings->logo_url,
            'title' => $settings->invoice_title ?: 'Rechnung',

            'invoice_no' => $period->invoiceNumber(),
            'issue_date' => $this->date($period->paid_at ?? $period->created_at ?? $period->starts_at),
            'period_start' => $this->date($period->starts_at),
            'period_end' => $this->date($period->ends_at),

            'customer_name' => $tenant?->name ?? '—',
            'customer_address' => $this->customerAddress($tenant),
            'customer_no' => $tenant !== null ? sprintf('KD-%04d', $tenant->id) : null,
            'activation_code' => $code?->code,

            'item_title' => $planName !== null ? 'Reidey '.$planName : 'Reidey Flotten-Abo',
            'item_desc' => 'Live-Dispatch, Fahrer-Push & Auswertung · Laufzeit '.$period->days.' Tage',
            'quantity' => 1,

            'currency' => $settings->currency,
            'net' => $this->format($money['net'], $symbol),
            'vat' => $this->format($money['vat'], $symbol),
            'gross' => $this->format($money['gross'], $symbol),
            'unit_price' => $this->format($money['gross'], $symbol),
            'vat_rate' => rtrim(rtrim(number_format((float) $settings->vat_rate, 2, ',', '.'), '0'), ','),
            'kleinunternehmer' => (bool) $settings->kleinunternehmer,

            'paid' => $period->isPaid(),
            'paid_at' => $period->paid_at !== null ? $this->date($period->paid_at) : null,
            'payment_method' => 'Aktivierungscode',
            'sold_by' => $soldBy ?? 'Reidey Vertrieb',
        ];
    }

    /**
     * Split a gross amount into net + VAT + gross, in cents. The stored amount is
     * treated as GROSS. Under the Kleinunternehmer rule (§19 UStG) no VAT is
     * charged, so net equals gross.
     *
     * @return array{net: int, vat: int, gross: int}
     */
    private function splitMoney(float|string|null $amount, float $vatRate, bool $kleinunternehmer): array
    {
        $gross = (int) round(((float) $amount) * 100);

        if ($kleinunternehmer || $vatRate <= 0) {
            return ['net' => $gross, 'vat' => 0, 'gross' => $gross];
        }

        $net = (int) round($gross / (1 + $vatRate / 100));

        return ['net' => $net, 'vat' => $gross - $net, 'gross' => $gross];
    }

    private function format(int $cents, string $symbol): string
    {
        return number_format($cents / 100, 2, ',', '.').' '.$symbol;
    }

    private function date(\DateTimeInterface $date): string
    {
        return $date->format('d.m.Y');
    }

    /** The customer address block (only the country is stored today). */
    private function customerAddress(?object $tenant): ?string
    {
        if ($tenant === null) {
            return null;
        }

        return $tenant->country === 'DE' ? 'Deutschland' : $tenant->country;
    }
}
