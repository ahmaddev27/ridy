<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Billing\InvoiceRenderer;
use App\Domain\Billing\Models\InvoiceSettings;
use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;

/**
 * Super-admin management of the single invoice template: edit issuer/bank/branding
 * + VAT posture, upload a logo, live-preview the rendered invoice, and download
 * the PDF for any subscription period.
 */
class InvoiceTemplateController extends Controller
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->present(InvoiceSettings::current())]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'issuer_name' => ['required', 'string', 'max:255'],
            'issuer_address' => ['required', 'string', 'max:1000'],
            'issuer_tax_id' => ['nullable', 'string', 'max:120'],
            'issuer_email' => ['nullable', 'email', 'max:255'],
            'issuer_phone' => ['nullable', 'string', 'max:60'],
            'issuer_website' => ['nullable', 'string', 'max:255'],
            'bank_iban' => ['nullable', 'string', 'max:64'],
            'bank_bic' => ['nullable', 'string', 'max:32'],
            'bank_name' => ['nullable', 'string', 'max:255'],
            'logo_url' => ['nullable', 'string', 'max:1000'],
            'accent_color' => ['nullable', 'string', 'max:9'],
            'invoice_title' => ['required', 'string', 'max:60'],
            'number_prefix' => ['required', 'string', 'max:12'],
            'vat_rate' => ['required', 'numeric', 'min:0', 'max:100'],
            'kleinunternehmer' => ['required', 'boolean'],
            'currency' => ['required', 'string', 'max:8'],
            'header_note' => ['nullable', 'string', 'max:255'],
            'footer_thanks' => ['required', 'string', 'max:500'],
            'footer_terms' => ['required', 'string', 'max:2000'],
        ]);

        $settings = InvoiceSettings::current();
        $settings->update($data);

        return response()->json(['data' => $this->present($settings->fresh())]);
    }

    /** Upload the invoice logo; returns an absolute URL usable in the template. */
    public function uploadImage(Request $request): JsonResponse
    {
        $request->validate([
            // Raster formats only — SVG is a script-injection vector, so it's excluded.
            'image' => ['required', 'image', 'mimes:png,jpg,jpeg,webp', 'max:2048', 'dimensions:max_width=2000,max_height=2000'],
        ]);

        $path = $request->file('image')->store('invoice-images', 'public');

        return response()->json(['data' => ['url' => Storage::disk('public')->url($path)]]);
    }

    /** Render the template with the design's sample values for the preview iframe. */
    public function preview(InvoiceRenderer $renderer): Response
    {
        $html = $renderer->htmlFromData($renderer->sampleData(InvoiceSettings::current()));

        return response($html, 200, ['Content-Type' => 'text/html; charset=UTF-8']);
    }

    /** Stream the PDF for a subscription period as a downloadable attachment. */
    public function pdf(SubscriptionPeriod $invoice, InvoiceRenderer $renderer): Response
    {
        $invoice->loadMissing(['tenant', 'code.plan', 'code.collector']);
        $pdf = $renderer->pdf($invoice, InvoiceSettings::current());

        return $pdf->download($invoice->invoiceNumber().'.pdf');
    }

    /** @return array<string, mixed> */
    private function present(InvoiceSettings $s): array
    {
        return [
            'issuer_name' => $s->issuer_name,
            'issuer_address' => $s->issuer_address,
            'issuer_tax_id' => $s->issuer_tax_id,
            'issuer_email' => $s->issuer_email,
            'issuer_phone' => $s->issuer_phone,
            'issuer_website' => $s->issuer_website,
            'bank_iban' => $s->bank_iban,
            'bank_bic' => $s->bank_bic,
            'bank_name' => $s->bank_name,
            'logo_url' => $s->logo_url,
            'accent_color' => $s->accent_color,
            'invoice_title' => $s->invoice_title,
            'number_prefix' => $s->number_prefix,
            'vat_rate' => (float) $s->vat_rate,
            'kleinunternehmer' => (bool) $s->kleinunternehmer,
            'currency' => $s->currency,
            'header_note' => $s->header_note,
            'footer_thanks' => $s->footer_thanks,
            'footer_terms' => $s->footer_terms,
        ];
    }
}
