<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('elprofessor_submissions', function (Blueprint $table) {
            // Audit material, kept in COLUMNS and not in `payload` on purpose:
            // the payload is merged verbatim into what El-Professor fetches and
            // shown field by field to the driver, and neither of those has any
            // business with the raw OCR text or how each figure was arrived at.
            // Nullable because builds from before this carry neither.
            $table->text('ocr_text')->nullable()->after('payload');
            $table->json('ocr_meta')->nullable()->after('ocr_text');
        });
    }

    public function down(): void
    {
        Schema::table('elprofessor_submissions', function (Blueprint $table) {
            $table->dropColumn(['ocr_text', 'ocr_meta']);
        });
    }
};
