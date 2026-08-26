<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The driver app is now passwordless: instead of an activation link that set a
 * password, the invitation emails a one-time sign-in code. Rewrite the
 * driver_invite template to show the code (only while it still matches the
 * previous link-based default, so a manager's custom copy is untouched), and
 * seed a driver_login_otp template for re-login codes.
 */
return new class extends Migration
{
    private const OLD_HTML = '<h2>Hallo {{driver_name}},</h2>'
        .'<p>{{company_name}} lädt dich ein, Reidey zu nutzen — Fahrtangebote sofort auf deinem Handy.</p>'
        .'<p><strong>1. App installieren</strong> (wähle dein Gerät):</p>'
        .'<p><a href="{{download_android}}" class="btn">Android</a>&nbsp;&nbsp;'
        .'<a href="{{download_ios}}" class="btn">iPhone</a></p>'
        .'<p><strong>2. Konto aktivieren:</strong></p>'
        .'<p><a href="{{invite_link}}" class="btn">Einladung annehmen</a></p>';

    private const NEW_HTML = '<h2>Hallo {{driver_name}},</h2>'
        .'<p>{{company_name}} lädt dich ein, Reidey zu nutzen — Fahrtangebote sofort auf deinem Handy.</p>'
        .'<p><strong>1. App installieren</strong> (wähle dein Gerät):</p>'
        .'<p><a href="{{download_android}}" class="btn">Android</a>&nbsp;&nbsp;'
        .'<a href="{{download_ios}}" class="btn">iPhone</a></p>'
        .'<p><strong>2. Anmelden</strong> — gib deine E-Mail und diesen Code in der App ein:</p>'
        .'<p style="font-size:28px;font-weight:800;letter-spacing:6px;margin:16px 0">{{otp}}</p>'
        .'<p>Kein Passwort nötig. Der Code ist nur kurze Zeit gültig.</p>';

    public function up(): void
    {
        DB::table('email_templates')
            ->where('key', 'driver_invite')
            ->where('body_html', self::OLD_HTML)
            ->update(['body_html' => self::NEW_HTML, 'updated_at' => now()]);

        $now = now();

        DB::table('email_templates')->updateOrInsert(
            ['key' => 'driver_login_otp'],
            [
                'subject' => 'Dein Anmeldecode',
                'body_html' => '<h2>Hallo {{name}},</h2>'
                    .'<p>Gib diesen Code in der Reidey-App ein, um dich anzumelden:</p>'
                    .'<p style="font-size:28px;font-weight:800;letter-spacing:6px;margin:16px 0">{{otp}}</p>'
                    .'<p>Der Code ist nur kurze Zeit gültig. Wenn du das nicht warst, ignoriere diese E-Mail.</p>',
                'accent_color' => '#059669',
                'footer_text' => 'Reidey · Fleet Management',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        );
    }

    public function down(): void
    {
        DB::table('email_templates')
            ->where('key', 'driver_invite')
            ->where('body_html', self::NEW_HTML)
            ->update(['body_html' => self::OLD_HTML, 'updated_at' => now()]);

        DB::table('email_templates')->where('key', 'driver_login_otp')->delete();
    }
};
