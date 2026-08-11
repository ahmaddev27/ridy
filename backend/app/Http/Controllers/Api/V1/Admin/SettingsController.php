<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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

            // Shown to suspended companies on the "contact support" screen.
            'support_email' => Settings::get('support_email'),
            'support_whatsapp' => Settings::get('support_whatsapp'),
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
            'support_email' => ['nullable', 'email'],
            'support_whatsapp' => ['nullable', 'string', 'max:32'],
        ]);

        $map = [
            'smtp_host', 'smtp_port', 'smtp_username', 'smtp_encryption',
            'mail_from_address', 'mail_from_name', 'support_email', 'support_whatsapp',
        ];
        $values = [];
        foreach ($map as $key) {
            if (array_key_exists($key, $data)) {
                $values[$key] = $data[$key] !== null ? (string) $data[$key] : null;
            }
        }
        // The SMTP password is only overwritten when a non-empty value is
        // submitted; an explicit empty string clears it.
        if ($request->has('smtp_password')) {
            $values['smtp_password'] = ($data['smtp_password'] ?? '') !== '' ? $data['smtp_password'] : null;
        }

        Settings::setMany($values);

        return $this->show();
    }
}
