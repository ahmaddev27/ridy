<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Seed polished, ready-to-send German copy for every email template so each one
 * reads well out of the box. Idempotent (updateOrInsert on the key). The renderer
 * wraps this body in the branded layout (logo, accent bar, footer) and styles
 * `.btn` links with the accent colour, so the bodies stay focused on the message.
 */
return new class extends Migration
{
    /** A big, spaced-out one-time code — shared by every OTP template. */
    private function code(): string
    {
        return '<p style="font-size:30px;font-weight:800;letter-spacing:6px;margin:18px 0;color:#111">{{otp}}</p>';
    }

    public function up(): void
    {
        $code = $this->code();

        $templates = [
            'driver_invite' => [
                'subject' => '{{company_name}} lädt dich zu Reidey ein',
                'body' => '<h2>Hallo {{driver_name}},</h2>'
                    .'<p>{{company_name}} lädt dich ein, Reidey zu nutzen — neue Fahrtangebote kommen sofort auf dein Handy, mit Preis pro Kilometer und Route auf einen Blick.</p>'
                    .'<p><strong>1. App installieren</strong> (wähle dein Gerät):</p>'
                    .'<p><a href="{{download_android}}" class="btn">Android</a>&nbsp;&nbsp;<a href="{{download_ios}}" class="btn">iPhone</a></p>'
                    .'<p><strong>2. Anmelden</strong> — gib in der App deine E-Mail und diesen Code ein:</p>'
                    .$code
                    .'<p>Kein Passwort nötig. Der Code ist nur kurze Zeit gültig. Willkommen an Bord!</p>',
            ],
            'driver_login_otp' => [
                'subject' => 'Dein Anmeldecode',
                'body' => '<h2>Hallo {{name}},</h2>'
                    .'<p>Gib diesen Code in der Reidey-App ein, um dich anzumelden:</p>'
                    .$code
                    .'<p>Der Code ist nur kurze Zeit gültig. Kein Passwort nötig. Wenn du das nicht warst, ignoriere diese E-Mail.</p>',
            ],
            'company_otp' => [
                'subject' => 'Dein Bestätigungscode',
                'body' => '<h2>Hallo {{name}},</h2>'
                    .'<p>Willkommen bei Reidey! Gib diesen Code ein, um deine Registrierung abzuschließen:</p>'
                    .$code
                    .'<p>Der Code ist nur kurze Zeit gültig. Wenn du dich nicht registriert hast, ignoriere diese E-Mail.</p>',
            ],
            'password_otp' => [
                'subject' => 'Passwort zurücksetzen',
                'body' => '<h2>Hallo {{name}},</h2>'
                    .'<p>Du hast angefragt, dein Passwort zurückzusetzen. Gib diesen Code ein, um fortzufahren:</p>'
                    .$code
                    .'<p>Wenn du das nicht warst, kannst du diese E-Mail ignorieren — dein Passwort bleibt unverändert.</p>',
            ],
            'company_registration' => [
                'subject' => 'Willkommen bei Reidey',
                'body' => '<h2>Willkommen bei Reidey, {{manager_name}}!</h2>'
                    .'<p>Das Konto für <strong>{{company_name}}</strong> ist eingerichtet. Du kannst deine Flotte jetzt verwalten — Fahrer einladen, Angebote verfolgen und deine Zahlen im Blick behalten.</p>'
                    .'<p><a href="{{login_url}}" class="btn">Zum Dashboard anmelden</a></p>'
                    .'<p>Viel Erfolg mit deiner Flotte!</p>',
            ],
        ];

        // The notification-style templates carry a code-supplied title/body/action.
        $notificationKeys = [
            'notification', 'subscription_expiring', 'subscription_expired',
            'subscription_activated', 'subscription_free', 'session_needs_relink',
            'company_banned', 'company_registered', 'proxy_expiring', 'code_activated',
        ];
        $notificationBody = '<h2>{{title}}</h2>'
            .'<p>{{body}}</p>'
            .'<p><a href="{{action_url}}" class="btn">{{action_label}}</a></p>';
        foreach ($notificationKeys as $key) {
            $templates[$key] = ['subject' => '{{title}}', 'body' => $notificationBody];
        }

        $now = now();
        foreach ($templates as $key => $t) {
            // Only subject + body are set, so a manager's custom accent/footer/logo
            // is never clobbered. New rows get the accent/footer default on insert.
            DB::table('email_templates')->updateOrInsert(
                ['key' => $key],
                [
                    'subject' => $t['subject'],
                    'body_html' => $t['body'],
                    'updated_at' => $now,
                ],
            );

            // Give a brand-new row sensible branding defaults (untouched otherwise).
            DB::table('email_templates')
                ->where('key', $key)
                ->whereNull('accent_color')
                ->update(['accent_color' => '#059669', 'footer_text' => 'Reidey · Fleet Management']);
        }
    }

    public function down(): void
    {
        // Content-only migration — no structural rollback.
    }
};
