<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The registration- and password-reset OTP emails were sent by key
 * (company_otp / password_otp) but had no stored template, so they rendered
 * empty and never actually reached the user. Seed both so they deliver AND
 * become editable in the admin's email-template settings like every other mail.
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        DB::table('email_templates')->updateOrInsert(
            ['key' => 'company_otp'],
            [
                'subject' => 'Dein Bestätigungscode',
                'body_html' => '<h2>Hallo {{name}},</h2>'
                    .'<p>Willkommen bei Reidey. Gib diesen Code ein, um deine Registrierung abzuschließen:</p>'
                    .'<p style="font-size:28px;font-weight:800;letter-spacing:6px;margin:16px 0">{{otp}}</p>'
                    .'<p>Der Code ist nur kurze Zeit gültig. Wenn du dich nicht registriert hast, ignoriere diese E-Mail.</p>',
                'accent_color' => '#059669',
                'footer_text' => 'Reidey · Fleet Management',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        );

        DB::table('email_templates')->updateOrInsert(
            ['key' => 'password_otp'],
            [
                'subject' => 'Passwort zurücksetzen',
                'body_html' => '<h2>Hallo {{name}},</h2>'
                    .'<p>Du hast angefragt, dein Passwort zurückzusetzen. Gib diesen Code ein, um fortzufahren:</p>'
                    .'<p style="font-size:28px;font-weight:800;letter-spacing:6px;margin:16px 0">{{otp}}</p>'
                    .'<p>Wenn du das nicht warst, kannst du diese E-Mail ignorieren. Dein Passwort bleibt unverändert.</p>',
                'accent_color' => '#059669',
                'footer_text' => 'Reidey · Fleet Management',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        );
    }

    public function down(): void
    {
        DB::table('email_templates')->whereIn('key', ['company_otp', 'password_otp'])->delete();
    }
};
