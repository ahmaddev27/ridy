<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Makes the invoice template's fixed German headings overridable and turns the
 * footer fine-print into an editable, reorderable set of column blocks.
 *
 * Both columns are nullable: an install that never touches them keeps rendering
 * the built-in German defaults and the derived 3-column footer, so nothing
 * regresses (see InvoiceSettings::label() / footerBlocks()).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoice_settings', function (Blueprint $table) {
            // Flat map of heading overrides (key => custom text).
            $table->json('labels')->nullable()->after('footer_terms');
            // Ordered array of footer columns: [{heading, lines:[{label,value}]}].
            $table->json('footer_blocks')->nullable()->after('labels');
        });
    }

    public function down(): void
    {
        Schema::table('invoice_settings', function (Blueprint $table) {
            $table->dropColumn(['labels', 'footer_blocks']);
        });
    }
};
