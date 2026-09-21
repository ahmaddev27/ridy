<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Live platform settings (SMTP + global residential proxy), editable by the
 * super-admin. Secrets (SMTP password, proxy creds) are never returned in full.
 */
class SettingsController extends Controller
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => [
            'smtp_host' => Settings::get('smtp_host'),
            'smtp_port' => Settings::get('smtp_port', '587'),
            'smtp_username' => Settings::get('smtp_username'),
            'smtp_encryption' => Settings::get('smtp_encryption', 'tls'),
            'mail_from_address' => Settings::get('mail_from_address'),
            'mail_from_name' => Settings::get('mail_from_name'),
            'has_smtp_password' => (bool) Settings::get('smtp_password'),

            'mail_provider' => Settings::get('mail_provider', 'smtp'),
            'has_resend_key' => (bool) Settings::get('resend_api_key'),

            // Shown to suspended companies on the "contact support" screen.
            'support_email' => Settings::get('support_email'),
            'support_whatsapp' => Settings::get('support_whatsapp'),

            // Subscription payment methods shown to a company on its subscription /
            // suspended screen. Each method is independently on/off.
            'pay_bank_enabled' => Settings::get('pay_bank_enabled') === '1',
            'pay_bank_holder' => Settings::get('pay_bank_holder'),
            'pay_bank_name' => Settings::get('pay_bank_name'),
            'pay_bank_iban' => Settings::get('pay_bank_iban'),
            'pay_bank_bic' => Settings::get('pay_bank_bic'),
            'pay_bank_amount' => Settings::get('pay_bank_amount'),
            'pay_bank_note' => Settings::get('pay_bank_note'),
            'pay_cash_enabled' => Settings::get('pay_cash_enabled') === '1',
            'pay_cash_whatsapp' => Settings::get('pay_cash_whatsapp'),
            'pay_cash_note' => Settings::get('pay_cash_note'),

            // Mobile driver-app force-update gate (min supported version + store links).
            'app_min_android' => Settings::get('app_min_android'),
            'app_min_ios' => Settings::get('app_min_ios'),
            'app_android_store_url' => Settings::get('app_android_store_url'),
            'app_ios_store_url' => Settings::get('app_ios_store_url'),
        ]]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'smtp_host' => ['nullable', 'string', 'max:255'],
            'smtp_port' => ['nullable', 'integer', 'between:1,65535'],
            'smtp_username' => ['nullable', 'string', 'max:255'],
            'smtp_password' => ['nullable', 'string', 'max:255'], // only when changing
            'smtp_encryption' => ['nullable', 'in:tls,ssl,none'],
            'mail_from_address' => ['nullable', 'email'],
            'mail_from_name' => ['nullable', 'string', 'max:255'],
            'mail_provider' => ['nullable', 'in:smtp,resend'],
            'resend_api_key' => ['nullable', 'string', 'max:255'], // only when changing
            'support_email' => ['nullable', 'email'],
            'support_whatsapp' => ['nullable', 'string', 'max:32'],
            'pay_bank_enabled' => ['nullable', 'boolean'],
            'pay_bank_holder' => ['nullable', 'string', 'max:255'],
            'pay_bank_name' => ['nullable', 'string', 'max:255'],
            'pay_bank_iban' => ['nullable', 'string', 'max:64'],
            'pay_bank_bic' => ['nullable', 'string', 'max:32'],
            'pay_bank_amount' => ['nullable', 'numeric', 'min:0', 'max:99999'],
            'pay_bank_note' => ['nullable', 'string', 'max:500'],
            'pay_cash_enabled' => ['nullable', 'boolean'],
            'pay_cash_whatsapp' => ['nullable', 'string', 'max:32'],
            'pay_cash_note' => ['nullable', 'string', 'max:500'],
            'app_min_android' => ['nullable', 'string', 'max:20'],
            'app_min_ios' => ['nullable', 'string', 'max:20'],
            'app_android_store_url' => ['nullable', 'url', 'max:255'],
            'app_ios_store_url' => ['nullable', 'url', 'max:255'],
        ]);

        $map = [
            'smtp_host', 'smtp_port', 'smtp_username', 'smtp_encryption',
            'mail_from_address', 'mail_from_name', 'mail_provider', 'support_email', 'support_whatsapp',
            'pay_bank_holder', 'pay_bank_name', 'pay_bank_iban', 'pay_bank_bic', 'pay_bank_amount', 'pay_bank_note',
            'pay_cash_whatsapp', 'pay_cash_note',
            'app_min_android', 'app_min_ios', 'app_android_store_url', 'app_ios_store_url',
        ];
        $values = [];
        foreach ($map as $key) {
            if (array_key_exists($key, $data)) {
                $values[$key] = $data[$key] !== null ? (string) $data[$key] : null;
            }
        }
        // Boolean toggles are stored as "1"/"" strings (the KV store is string-only).
        foreach (['pay_bank_enabled', 'pay_cash_enabled'] as $flag) {
            if ($request->has($flag)) {
                $values[$flag] = $request->boolean($flag) ? '1' : '';
            }
        }
        // Secrets are only overwritten when a non-empty value is submitted; an
        // explicit empty string clears them.
        foreach (['smtp_password', 'resend_api_key'] as $secret) {
            if ($request->has($secret)) {
                $values[$secret] = ($data[$secret] ?? '') !== '' ? $data[$secret] : null;
            }
        }

        Settings::setMany($values);

        return $this->show();
    }

    /**
     * Send a test email to the super-admin's own address using the currently
     * saved provider (SMTP or Resend), so delivery can be verified before any
     * real emails go out. The provider config is applied at boot; here we just
     * try to send and surface any transport error verbatim.
     */
    public function testEmail(Request $request): JsonResponse
    {
        $data = $request->validate(['to' => ['nullable', 'email']]);
        $to = $data['to'] ?? (string) $request->user()->email;

        try {
            Mail::html('<p>This is a test email from Reidey. If you received it, email delivery is working.</p>', function ($m) use ($to) {
                $m->to($to)->subject('Reidey · Test email');
            });
        } catch (Throwable $e) {
            return response()->json(['data' => ['sent' => false, 'error' => $e->getMessage()]], 422);
        }

        return response()->json(['data' => ['sent' => true, 'to' => $to]]);
    }
}
