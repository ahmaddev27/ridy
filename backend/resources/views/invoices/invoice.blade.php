@php
    /**
     * dompdf has no flexbox/grid and weak CSS — this template is deliberately
     * table-based with inline/embedded styles and the built-in "DejaVu Sans"
     * font (the only bundled face that renders € and German umlauts).
     */
    $ink = '#17211d';
    $muted = '#5f6f68';
    $faint = '#93a099';
    $line = '#e6ece8';
    $lineStrong = '#d3ddd7';
    $tint = '#eef5f1';
@endphp
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <style>
        @page { margin: 0; }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: "DejaVu Sans", sans-serif;
            color: {{ $ink }};
            font-size: 12px;
            line-height: 1.5;
        }
        .sheet { padding: 48px 44px 36px; }
        table { border-collapse: collapse; width: 100%; }
        .eyebrow { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: {{ $faint }}; font-weight: bold; }
        .label { font-size: 8.5px; letter-spacing: 1px; text-transform: uppercase; color: {{ $faint }}; font-weight: bold; }
        .muted { color: {{ $muted }}; }
        .r { text-align: right; }
        .brand-name { font-size: 18px; font-weight: bold; letter-spacing: -0.5px; }
        .brand-sub { font-size: 11px; color: {{ $muted }}; }
        .doc-title { font-size: 26px; font-weight: bold; letter-spacing: -0.5px; }
        .accent { color: {{ $accent }}; }
        .val { font-size: 12.5px; font-weight: bold; }
        .party-name { font-size: 13px; font-weight: bold; }
        .addr { font-size: 11.5px; color: {{ $muted }}; line-height: 1.5; }
        .items th { text-align: left; font-size: 8.5px; letter-spacing: 1px; text-transform: uppercase; color: {{ $faint }}; font-weight: bold; padding: 0 0 8px; border-bottom: 1.5px solid {{ $lineStrong }}; }
        .items td { padding: 12px 0; border-bottom: 1px solid {{ $line }}; vertical-align: top; }
        .item-title { font-weight: bold; font-size: 12.5px; }
        .item-desc { font-size: 11px; color: {{ $muted }}; padding-top: 2px; }
        .amt { font-weight: bold; font-size: 12.5px; }
        .totrow td { padding: 6px 0; font-size: 12px; color: {{ $muted }}; }
        .totrow td.v { color: {{ $ink }}; font-weight: bold; text-align: right; }
        .paid-badge { background: {{ $tint }}; color: {{ $accent }}; font-weight: bold; font-size: 12px; padding: 6px 12px; }
        .paymeta { font-size: 11.5px; color: {{ $muted }}; }
        .paymeta .k { color: {{ $faint }}; }
        footer { margin-top: 34px; padding-top: 16px; border-top: 1px solid {{ $line }}; }
        .thanks { font-size: 12.5px; font-weight: bold; }
        .terms { font-size: 10.5px; color: {{ $muted }}; padding-top: 5px; }
        .fine .label { padding-bottom: 3px; }
        .fine .v { font-size: 10.5px; color: {{ $muted }}; line-height: 1.55; }
    </style>
</head>
<body>
<div class="sheet">

    {{-- Header: brand + document title --}}
    <table>
        <tr>
            <td style="vertical-align: top; width: 60%;">
                <table>
                    <tr>
                        @if ($logo_url)
                            <td style="width: 52px; vertical-align: middle;">
                                <img src="{{ $logo_url }}" alt="" style="width: 44px; height: 44px;">
                            </td>
                        @else
                            <td style="width: 52px; vertical-align: middle;">
                                <table style="width: 44px; height: 44px; background: {{ $accent }};">
                                    <tr><td style="text-align: center; color: #ffffff; font-size: 24px; font-weight: bold;">R</td></tr>
                                </table>
                            </td>
                        @endif
                        <td style="vertical-align: middle; padding-left: 10px;">
                            <div class="brand-name">{{ $settings->issuer_name }}</div>
                            @if ($settings->header_note)
                                <div class="brand-sub">{{ $settings->header_note }}</div>
                            @endif
                        </td>
                    </tr>
                </table>
            </td>
            <td style="vertical-align: top; text-align: right; width: 40%;">
                <div class="doc-title">{{ $title }}</div>
                <div style="padding-top: 6px;">
                    <span class="eyebrow">Rechnungs-Nr.</span><br>
                    <span class="val">{{ $invoice_no }}</span>
                </div>
            </td>
        </tr>
    </table>

    <div style="height: 2px; background: {{ $accent }}; margin: 20px 0 0;"></div>

    {{-- Parties + dates --}}
    <table style="margin-top: 22px;">
        <tr>
            <td style="vertical-align: top; width: 42%;">
                <div class="label">Rechnung an</div>
                <div class="party-name" style="padding-top: 4px;">{{ $customer_name }}</div>
                @if ($customer_address)
                    <div class="addr" style="padding-top: 2px;">{!! nl2br(e($customer_address)) !!}</div>
                @endif
            </td>
            <td style="vertical-align: top; width: 29%;">
                <div class="label">Rechnungsdatum</div>
                <div class="val" style="padding-top: 3px;">{{ $issue_date }}</div>
                <div class="label" style="padding-top: 12px;">Leistungszeitraum</div>
                <div class="val" style="padding-top: 3px;">{{ $period_start }} – {{ $period_end }}</div>
            </td>
            <td style="vertical-align: top; width: 29%;">
                @if ($activation_code)
                    <div class="label">Aktivierungscode</div>
                    <div class="val" style="padding-top: 3px;">{{ $activation_code }}</div>
                @endif
                @if ($customer_no)
                    <div class="label" style="padding-top: 12px;">Kunden-Nr.</div>
                    <div class="val" style="padding-top: 3px;">{{ $customer_no }}</div>
                @endif
            </td>
        </tr>
    </table>

    {{-- Line items --}}
    <table class="items" style="margin-top: 28px;">
        <thead>
            <tr>
                <th style="width: 58%;">Beschreibung</th>
                <th class="r" style="width: 10%;">Menge</th>
                <th class="r" style="width: 16%;">Einzelpreis</th>
                <th class="r" style="width: 16%;">Betrag</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td>
                    <div class="item-title">{{ $item_title }}</div>
                    <div class="item-desc">{{ $item_desc }}</div>
                </td>
                <td class="r muted">{{ $quantity }}</td>
                <td class="r amt">{{ $unit_price }}</td>
                <td class="r amt">{{ $gross }}</td>
            </tr>
        </tbody>
    </table>

    {{-- Payment status + totals --}}
    <table style="margin-top: 22px;">
        <tr>
            <td style="vertical-align: bottom; width: 55%;">
                @if ($paid)
                    <table><tr><td class="paid-badge">&#10004;&nbsp;Bezahlt</td></tr></table>
                    <table class="paymeta" style="margin-top: 10px;">
                        @if ($paid_at)
                            <tr><td class="k" style="width: 95px;">Bezahlt am</td><td>{{ $paid_at }}</td></tr>
                        @endif
                        <tr><td class="k">Zahlungsart</td><td>{{ $payment_method }}</td></tr>
                        <tr><td class="k">Vermittelt von</td><td>{{ $sold_by }}</td></tr>
                    </table>
                @endif
            </td>
            <td style="vertical-align: top; width: 45%;">
                <table>
                    <tr class="totrow">
                        <td>Zwischensumme (netto)</td>
                        <td class="v">{{ $net }}</td>
                    </tr>
                    @if ($kleinunternehmer)
                        <tr class="totrow"><td colspan="2" style="font-size: 10px;">Gemäß §19 UStG wird keine Umsatzsteuer berechnet.</td></tr>
                    @else
                        <tr class="totrow">
                            <td>zzgl. {{ $vat_rate }} % MwSt.</td>
                            <td class="v">{{ $vat }}</td>
                        </tr>
                    @endif
                </table>
                <table style="margin-top: 6px; background: {{ $accent }};">
                    <tr>
                        <td style="padding: 11px 14px; color: #ffffff; font-weight: bold; font-size: 13px;">Gesamtbetrag</td>
                        <td style="padding: 11px 14px; color: #ffffff; font-weight: bold; font-size: 16px; text-align: right;">{{ $gross }}</td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>

    {{-- Footer --}}
    <footer>
        <div class="thanks">{{ $settings->footer_thanks }}</div>
        <div class="terms">{{ $settings->footer_terms }}</div>
        <table class="fine" style="margin-top: 18px;">
            <tr>
                <td style="vertical-align: top; width: 34%;">
                    <div class="label">{{ $settings->issuer_name }}</div>
                    <div class="v">{!! nl2br(e($settings->issuer_address)) !!}</div>
                </td>
                <td style="vertical-align: top; width: 33%;">
                    <div class="label">Kontakt</div>
                    <div class="v">
                        @if ($settings->issuer_email){{ $settings->issuer_email }}<br>@endif
                        @if ($settings->issuer_website){{ $settings->issuer_website }}<br>@endif
                        @if ($settings->issuer_phone){{ $settings->issuer_phone }}@endif
                    </div>
                </td>
                <td style="vertical-align: top; width: 33%;">
                    <div class="label">Steuer &amp; Bank</div>
                    <div class="v">
                        @if ($settings->issuer_tax_id)USt-IdNr. {{ $settings->issuer_tax_id }}<br>@endif
                        @if ($settings->bank_iban)IBAN {{ $settings->bank_iban }}<br>@endif
                        @if ($settings->bank_bic)BIC {{ $settings->bank_bic }}@endif
                    </div>
                </td>
            </tr>
        </table>
    </footer>

</div>
</body>
</html>
