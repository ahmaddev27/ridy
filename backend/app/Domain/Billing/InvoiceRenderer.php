<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Models\InvoiceSettings;
use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Tenancy\Models\Tenant;
use Barryvdh\DomPDF\Facade\Pdf;
use Barryvdh\DomPDF\PDF as DomPdf;
use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Turns a {@see SubscriptionPeriod} into a normalized, presentation-ready view
 * model and renders it as either HTML (live preview) or a dompdf PDF (download
 * / email attachment). All money is computed in integer cents to avoid float
 * drift, then formatted de-DE ("149,00 €").
 *
 * An issued invoice is immutable (GoBD): {@see snapshot()} freezes the issuer/VAT
 * settings and the customer block on the period when its number is assigned, and
 * every later render reads that snapshot instead of the live settings/tenant.
 * Only legacy periods (issued before snapshots existed) render from live data.
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
            'payment_ref' => 'ASF-'.date('Y').'-0042',

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
            'payment_method' => $this->paymentMethodLabel('bank'),
            'sold_by' => 'Reidey Vertrieb',
        ];
    }

    /** @param array<string, mixed> $data */
    private function pdfFromData(array $data): DomPdf
    {
        // Remote fetching stays OFF: the logo is inlined from local storage, so a
        // stored logo_url can never make the backend fetch an arbitrary URL (SSRF)
        // or hairpin through the public site on every render.
        $data['logo_url'] = $this->inlineLogo($data['logo_url'] ?? null);

        return Pdf::loadView(self::VIEW, $data)
            ->setPaper('a4')
            ->setOption('isRemoteEnabled', false);
    }

    /**
     * Freeze what this invoice prints — the issuer/VAT/bank settings and the
     * customer + plan block — together with its issue date. Called once, when the
     * invoice number is assigned; later settings or tenant renames never change it.
     */
    public function snapshot(SubscriptionPeriod $period, InvoiceSettings $settings, ?Tenant $tenant, \DateTimeInterface $issuedAt): void
    {
        $period->loadMissing(['code.plan', 'code.collector']);
        $code = $period->code;

        $period->forceFill([
            'issued_at' => $issuedAt,
            'invoice_snapshot' => [
                'settings' => $settings->only($settings->getFillable()),
                'customer_name' => $tenant?->name,
                'customer_address' => $this->customerAddress($tenant),
                'customer_no' => $tenant !== null ? sprintf('KD-%04d', $tenant->id) : null,
                'plan_name' => $code?->plan?->name,
                'sold_by' => $code?->collector?->name,
                'payment_method' => $code?->payment_method,
                'activation_code' => $code?->code,
                'payment_ref' => $code?->payment_ref,
            ],
        ])->save();
    }

    /**
     * The logo as an inline data URI when it is one of our uploaded invoice images
     * (public disk, `invoice-images/`), else null — never a remote URL.
     */
    private function inlineLogo(?string $logoUrl): ?string
    {
        if ($logoUrl === null || $logoUrl === '' || str_starts_with($logoUrl, 'data:image/')) {
            return $logoUrl ?: null;
        }

        $path = (string) parse_url($logoUrl, PHP_URL_PATH);
        if (! preg_match('#/(invoice-images/[A-Za-z0-9._-]+)$#', $path, $m)) {
            return null;
        }

        try {
            $disk = Storage::disk('public');
            if (! $disk->exists($m[1])) {
                return null;
            }
            $mime = (string) $disk->mimeType($m[1]);
            if (! str_starts_with($mime, 'image/')) {
                return null;
            }

            return 'data:'.$mime.';base64,'.base64_encode((string) $disk->get($m[1]));
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * The normalized invoice view model. Callers (controller + Blade) only see
     * finished strings and booleans — no domain objects and no money math.
     *
     * @return array<string, mixed>
     */
    private function viewData(SubscriptionPeriod $period, InvoiceSettings $settings): array
    {
        $snap = is_array($period->invoice_snapshot) ? $period->invoice_snapshot : null;
        if ($snap !== null && is_array($snap['settings'] ?? null)) {
            $settings = (new InvoiceSettings)->forceFill($snap['settings']);
        }

        $tenant = $period->tenant;
        $code = $period->code;
        $money = $this->splitMoney($period->amount, (float) $settings->vat_rate, (bool) $settings->kleinunternehmer);
        $symbol = self::SYMBOLS[$settings->currency] ?? $settings->currency;

        // Snapshot values win; live values are the fallback for legacy invoices.
        $pick = fn (string $key, mixed $live) => $snap !== null && array_key_exists($key, $snap) ? $snap[$key] : $live;
        $planName = $pick('plan_name', $code?->plan?->name);
        $soldBy = $pick('sold_by', $code?->collector?->name);

        return [
            'settings' => $settings,
            'accent' => $settings->accent_color ?: '#0e6b4e',
            'logo_url' => $settings->logo_url,
            'title' => $settings->invoice_title ?: 'Rechnung',

            'invoice_no' => $period->invoiceNumber(),
            // The fixed issue date — settling an invoice later only sets paid_at.
            'issue_date' => $this->date($period->issued_at ?? $period->created_at ?? $period->starts_at),
            'period_start' => $this->date($period->starts_at),
            'period_end' => $this->date($period->ends_at),

            'customer_name' => $pick('customer_name', $tenant?->name) ?? '—',
            'customer_address' => $pick('customer_address', $this->customerAddress($tenant)),
            'customer_no' => $pick('customer_no', $tenant !== null ? sprintf('KD-%04d', $tenant->id) : null),
            'activation_code' => $pick('activation_code', $code?->code),
            'payment_ref' => $pick('payment_ref', $code?->payment_ref),

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
            'payment_method' => $this->paymentMethodLabel($pick('payment_method', $code?->payment_method)),
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

    /**
     * German label for how the invoice was paid. Falls back to "Aktivierungscode"
     * (the generic settlement label used before a method was recorded) when the
     * code carries no specific method.
     */
    private function paymentMethodLabel(?string $method): string
    {
        return match ($method) {
            'bank' => 'Banküberweisung',
            'cash' => 'Bar',
            default => 'Aktivierungscode',
        };
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
