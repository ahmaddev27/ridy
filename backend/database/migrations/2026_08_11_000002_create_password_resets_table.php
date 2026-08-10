<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Pending password resets awaiting email OTP verification. On a successful reset
 * the row is consumed (deleted). Also seeds the customizable reset OTP email
 * template.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('password_resets', function (Blueprint $table) {
            $table->id();
            $table->string('email')->unique();
            $table->string('otp', 6);
            $table->timestamp('otp_expires_at');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamps();
        });

        $now = now();
        DB::table('email_templates')->insert([
            'key' => 'password_otp',
            'subject' => 'Dein Reidey-Code zum Zurücksetzen: {{otp}}',
            'body_html' => '<h2>Passwort zurücksetzen</h2>'
                .'<p>Hallo {{name}}, dein Code zum Zurücksetzen deines Passworts lautet:</p>'
                .'<p style="font-size:28px;font-weight:700;letter-spacing:6px">{{otp}}</p>'
                .'<p>Der Code ist 10 Minuten gültig. Falls du das nicht angefragt hast, ignoriere diese E-Mail.</p>',
            'accent_color' => '#0f172a',
            'footer_text' => 'Reidey · Fleet Management',
            'created_at' => $now, 'updated_at' => $now,
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('password_resets');
        DB::table('email_templates')->where('key', 'password_otp')->delete();
    }
};
