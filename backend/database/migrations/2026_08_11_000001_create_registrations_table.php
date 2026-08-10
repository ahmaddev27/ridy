<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Pending company self-registrations awaiting email OTP verification. On verify
 * the row becomes a Tenant + owner User and is deleted. Also seeds the
 * customizable OTP email template.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('registrations', function (Blueprint $table) {
            $table->id();
            $table->string('email')->unique();
            $table->string('company_name');
            $table->string('name');
            $table->string('password'); // hashed
            $table->string('otp', 6);
            $table->timestamp('otp_expires_at');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamps();
        });

        $now = now();
        DB::table('email_templates')->insert([
            'key' => 'company_otp',
            'subject' => 'Dein Reidey-Bestätigungscode: {{otp}}',
            'body_html' => '<h2>Willkommen bei Reidey!</h2>'
                .'<p>Hallo {{name}}, dein Bestätigungscode lautet:</p>'
                .'<p style="font-size:28px;font-weight:700;letter-spacing:6px">{{otp}}</p>'
                .'<p>Der Code ist 10 Minuten gültig.</p>',
            'accent_color' => '#0f172a',
            'footer_text' => 'Reidey · Fleet Management',
            'created_at' => $now, 'updated_at' => $now,
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('registrations');
        DB::table('email_templates')->where('key', 'company_otp')->delete();
    }
};
