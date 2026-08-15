<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Web (browser) FCM push tokens for dashboard users — managers and super-admins.
 * Separate from device_tokens (which belong to drivers), keyed to a User.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_push_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('token', 512)->unique();
            $table->string('platform', 16)->default('web');
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_push_tokens');
    }
};
