<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Every notification event shared one generic "notification" template, so the
 * admin could not tailor, say, the "subscription expiring" mail separately.
 * Seed a dedicated, editable template per event. Each still renders the
 * code-provided localized {{title}}/{{body}} + CTA, so nothing breaks if a row
 * is missing, but each event now has its own subject/accent the admin can edit.
 */
return new class extends Migration
{
    /** Warm/urgent events get an amber accent; the rest use the brand green. */
    private const BRAND = '#059669';

    private const WARN = '#d97706';

    /** @return array<string, array{subject: string, accent: string}> */
    private function events(): array
    {
        return [
            'subscription_expiring' => ['subject' => 'Dein Abo läuft bald ab', 'accent' => self::WARN],
            'subscription_expired' => ['subject' => 'Dein Abo ist abgelaufen', 'accent' => self::WARN],
            'subscription_activated' => ['subject' => 'Dein Abo ist aktiv', 'accent' => self::BRAND],
            'subscription_free' => ['subject' => 'Kostenloses Abo freigeschaltet', 'accent' => self::BRAND],
            'session_needs_relink' => ['subject' => 'Uber-Verbindung erneuern', 'accent' => self::WARN],
            'company_banned' => ['subject' => 'Konto gesperrt', 'accent' => self::WARN],
            'company_registered' => ['subject' => 'Neue Firma registriert', 'accent' => self::BRAND],
            'proxy_expiring' => ['subject' => 'Proxy läuft bald ab', 'accent' => self::WARN],
            'code_activated' => ['subject' => 'Aktivierungscode eingelöst', 'accent' => self::BRAND],
        ];
    }

    public function up(): void
    {
        $now = now();

        $bodyHtml = '<h2>{{title}}</h2>'
            .'<p>{{body}}</p>'
            .'<p><a href="{{action_url}}" class="btn">{{action_label}}</a></p>';

        foreach ($this->events() as $key => $meta) {
            DB::table('email_templates')->updateOrInsert(
                ['key' => $key],
                [
                    'subject' => $meta['subject'],
                    'body_html' => $bodyHtml,
                    'accent_color' => $meta['accent'],
                    'footer_text' => 'Reidey · Fleet Management',
                    'created_at' => $now,
                    'updated_at' => $now,
                ],
            );
        }
    }

    public function down(): void
    {
        DB::table('email_templates')->whereIn('key', array_keys($this->events()))->delete();
    }
};
