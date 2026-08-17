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

    /**
     * Each event only differs by accent colour; the subject stays {{title}} so it
     * renders in the recipient's language (the Notifier fills the localized
     * title/body). The admin can still override any subject per event.
     *
     * @return array<string, string>
     */
    private function events(): array
    {
        return [
            'subscription_expiring' => self::WARN,
            'subscription_expired' => self::WARN,
            'subscription_activated' => self::BRAND,
            'subscription_free' => self::BRAND,
            'session_needs_relink' => self::WARN,
            'company_banned' => self::WARN,
            'company_registered' => self::BRAND,
            'proxy_expiring' => self::WARN,
            'code_activated' => self::BRAND,
        ];
    }

    public function up(): void
    {
        $now = now();

        $bodyHtml = '<h2>{{title}}</h2>'
            .'<p>{{body}}</p>'
            .'<p><a href="{{action_url}}" class="btn">{{action_label}}</a></p>';

        foreach ($this->events() as $key => $accent) {
            DB::table('email_templates')->updateOrInsert(
                ['key' => $key],
                [
                    'subject' => '{{title}}',
                    'body_html' => $bodyHtml,
                    'accent_color' => $accent,
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
