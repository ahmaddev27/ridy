<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Adds an "install the app" step (the admin-configured download link) to the
 * driver invitation email — drivers need the APK/store link before they can
 * activate. Only rewrites the template while it still matches the original
 * default, so a manager's custom copy is never clobbered.
 */
return new class extends Migration
{
    private const OLD_HTML = '<h2>Hallo {{driver_name}},</h2>'
        .'<p>{{company_name}} lädt dich ein, Reidey zu nutzen, um Fahrtangebote sofort auf dein Handy zu bekommen.</p>'
        .'<p><a href="{{invite_link}}" class="btn">Einladung annehmen</a></p>';

    private const NEW_HTML = '<h2>Hallo {{driver_name}},</h2>'
        .'<p>{{company_name}} lädt dich ein, Reidey zu nutzen — Fahrtangebote sofort auf deinem Handy.</p>'
        .'<p><strong>1. App installieren:</strong></p>'
        .'<p><a href="{{download_link}}" class="btn">App herunterladen</a></p>'
        .'<p><strong>2. Konto aktivieren:</strong></p>'
        .'<p><a href="{{invite_link}}" class="btn">Einladung annehmen</a></p>';

    public function up(): void
    {
        DB::table('email_templates')
            ->where('key', 'driver_invite')
            ->where('body_html', self::OLD_HTML)
            ->update(['body_html' => self::NEW_HTML, 'updated_at' => now()]);
    }

    public function down(): void
    {
        DB::table('email_templates')
            ->where('key', 'driver_invite')
            ->where('body_html', self::NEW_HTML)
            ->update(['body_html' => self::OLD_HTML, 'updated_at' => now()]);
    }
};
