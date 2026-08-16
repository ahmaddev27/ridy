<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A generic notification email template. The Notifier fills {{title}}/{{body}}
 * from the localized event copy and an optional call-to-action button, so any
 * bell/push event can also be delivered by email without a per-type template.
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        DB::table('email_templates')->updateOrInsert(
            ['key' => 'notification'],
            [
                'subject' => '{{title}}',
                'body_html' => '<h2>{{title}}</h2>'
                    .'<p>{{body}}</p>'
                    .'<p><a href="{{action_url}}" class="btn">{{action_label}}</a></p>',
                'accent_color' => '#4f46e5',
                'footer_text' => 'Reidey · Fleet Management',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        );
    }

    public function down(): void
    {
        DB::table('email_templates')->where('key', 'notification')->delete();
    }
};
