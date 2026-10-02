<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Replace the invite email's two device links (Android | iPhone) with ONE smart
 * install button → {{download_smart}} (the /get route redirects to the right
 * store by the device's User-Agent). Only the download line of the body changes;
 * a manager's accent/footer/logo are untouched. Idempotent: it rewrites the body
 * to the known-current layout, so a re-run is a no-op.
 */
return new class extends Migration
{
    public function up(): void
    {
        $code = '<p style="font-size:30px;font-weight:800;letter-spacing:6px;margin:18px 0;color:#111">{{otp}}</p>';

        $body = '<h2>Hallo {{driver_name}},</h2>'
            .'<p>{{company_name}} lädt dich ein, Reidey zu nutzen — neue Fahrtangebote kommen sofort auf dein Handy, mit Preis pro Kilometer und Route auf einen Blick.</p>'
            .'<p><strong>1. App installieren:</strong></p>'
            .'<p><a href="{{download_smart}}" class="btn">Reidey installieren</a></p>'
            .'<p><strong>2. Anmelden</strong> — gib in der App deine E-Mail und diesen Code ein:</p>'
            .$code
            .'<p>Kein Passwort nötig. Der Code ist nur kurze Zeit gültig. Willkommen an Bord!</p>';

        DB::table('email_templates')
            ->where('key', 'driver_invite')
            ->update(['body_html' => $body, 'updated_at' => now()]);
    }

    public function down(): void
    {
        $code = '<p style="font-size:30px;font-weight:800;letter-spacing:6px;margin:18px 0;color:#111">{{otp}}</p>';

        $body = '<h2>Hallo {{driver_name}},</h2>'
            .'<p>{{company_name}} lädt dich ein, Reidey zu nutzen — neue Fahrtangebote kommen sofort auf dein Handy, mit Preis pro Kilometer und Route auf einen Blick.</p>'
            .'<p><strong>1. App installieren</strong> (wähle dein Gerät):</p>'
            .'<p><a href="{{download_android}}" class="btn">Android</a>&nbsp;&nbsp;<a href="{{download_ios}}" class="btn">iPhone</a></p>'
            .'<p><strong>2. Anmelden</strong> — gib in der App deine E-Mail und diesen Code ein:</p>'
            .$code
            .'<p>Kein Passwort nötig. Der Code ist nur kurze Zeit gültig. Willkommen an Bord!</p>';

        DB::table('email_templates')
            ->where('key', 'driver_invite')
            ->update(['body_html' => $body, 'updated_at' => now()]);
    }
};
