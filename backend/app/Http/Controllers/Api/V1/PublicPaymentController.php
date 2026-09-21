<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;

/**
 * Public subscription payment methods, readable unauthenticated so the suspended
 * screen (pre-login) and the in-app subscription page can show a company HOW to
 * pay. Each method is returned only when the super-admin has enabled it; a
 * disabled method is null so the UI hides it (like the support WhatsApp number).
 * Only customer-facing payment details are exposed — never internal config.
 */
class PublicPaymentController extends Controller
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => [
            'bank' => Settings::get('pay_bank_enabled') === '1' ? [
                'holder' => Settings::get('pay_bank_holder'),
                'bank' => Settings::get('pay_bank_name'),
                'iban' => Settings::get('pay_bank_iban'),
                'bic' => Settings::get('pay_bank_bic'),
                // Prefilled into the GiroCode/EPC QR so a scan opens the bank app
                // with the amount already set (e.g. 300). Empty = open amount.
                'amount' => Settings::get('pay_bank_amount'),
                'note' => Settings::get('pay_bank_note'),
            ] : null,
            'cash' => Settings::get('pay_cash_enabled') === '1' ? [
                'whatsapp' => Settings::get('pay_cash_whatsapp'),
                'note' => Settings::get('pay_cash_note'),
            ] : null,
        ]]);
    }
}
