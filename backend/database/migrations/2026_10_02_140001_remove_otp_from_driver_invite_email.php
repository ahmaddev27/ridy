<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The invite email no longer carries a sign-in code: the driver installs the
 * app, enters their email, and the app requests a fresh code then. So drop the
 * {{otp}} block and reword step 2 to "open the app, enter your email". A manager's
 * accent/footer/logo are untouched. Idempotent: rewrites to the known body.
 */
return new class extends Migration
{
    public function up(): void
    {
        $body = '<h2>Hallo {{driver_name}},</h2>'
            .'<p>{{company_name}} lädt dich ein, Reidey zu nutzen — neue Fahrtangebote kommen sofort auf dein Handy, mit Preis pro Kilometer und Route auf einen Blick.</p>'
            .'<p><strong>1. App installieren:</strong></p>'
            .'<p><a href="{{download_smart}}" class="btn">Reidey installieren</a></p>'
            .'<p><strong>2. Anmelden:</strong> Öffne die App und gib deine E-Mail-Adresse ein — du erhältst dann einen Anmeldecode per E-Mail. Kein Passwort nötig.</p>'
            .'<p>Willkommen an Bord!</p>';

        DB::table('email_templates')
            ->where('key', 'driver_invite')
            ->update(['body_html' => $body, 'updated_at' => now()]);
    }

    public function down(): void
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
};
