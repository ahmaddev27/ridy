<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Platform email templates the super-admin fully customizes (subject, rich-text
 * body, logo image, accent colour, footer). One row per template key. The body
 * holds sanitized rich-text HTML with {{variables}} filled in at send time.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_templates', function (Blueprint $table) {
            $table->string('key')->primary(); // company_registration | driver_invite
            $table->string('subject');
            $table->text('body_html');
            $table->string('logo_url')->nullable();
            $table->string('accent_color')->default('#4f46e5');
            $table->string('footer_text')->nullable();
            $table->timestamps();
        });

        $now = now();
        DB::table('email_templates')->insert([
            [
                'key' => 'company_registration',
                'subject' => 'Willkommen bei Reidey, {{company_name}}',
                'body_html' => '<h2>Willkommen, {{company_name}}!</h2>'
                    .'<p>Hallo {{manager_name}}, dein Reidey-Konto ist bereit.</p>'
                    .'<p>Melde dich an, um deine Uber-Flotte zu verbinden und Angebote in Echtzeit zu empfangen.</p>'
                    .'<p><a href="{{login_url}}" class="btn">Zum Dashboard</a></p>',
                'accent_color' => '#4f46e5',
                'footer_text' => 'Reidey · Fleet Management',
                'created_at' => $now, 'updated_at' => $now,
            ],
            [
                'key' => 'driver_invite',
                'subject' => '{{company_name}} lädt dich zu Reidey ein',
                'body_html' => '<h2>Hallo {{driver_name}},</h2>'
                    .'<p>{{company_name}} lädt dich ein, Reidey zu nutzen, um Fahrtangebote sofort auf dein Handy zu bekommen.</p>'
                    .'<p><a href="{{invite_link}}" class="btn">Einladung annehmen</a></p>',
                'accent_color' => '#059669',
                'footer_text' => 'Reidey · Fleet Management',
                'created_at' => $now, 'updated_at' => $now,
            ],
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('email_templates');
    }
};
