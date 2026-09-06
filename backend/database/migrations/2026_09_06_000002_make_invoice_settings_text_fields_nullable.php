<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The invoice-template editor lets the super-admin blank ANY text line so it
 * drops from the rendered PDF (InvoiceTemplateController persists an emptied
 * field as NULL). But these five columns were created NOT NULL, so saving a
 * blank issuer/footer threw SQLSTATE[23000] 1048 "Column ... cannot be null".
 * Make them nullable so the "empty line vanishes" behaviour actually works.
 */
return new class extends Migration
{
    /** Columns the controller can now set to NULL but were created NOT NULL. */
    private array $columns = ['issuer_name', 'issuer_address', 'invoice_title', 'footer_thanks', 'footer_terms'];

    public function up(): void
    {
        if (! Schema::hasTable('invoice_settings')) {
            return;
        }

        Schema::table('invoice_settings', function (Blueprint $table) {
            // Restate each column's full definition + ->nullable() via change().
            // text columns can't carry a MySQL default; invoice_title keeps its.
            $table->string('issuer_name')->nullable()->change();
            $table->text('issuer_address')->nullable()->change();
            $table->string('invoice_title')->default('Rechnung')->nullable()->change();
            $table->text('footer_thanks')->nullable()->change();
            $table->text('footer_terms')->nullable()->change();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('invoice_settings')) {
            return;
        }

        // Best-effort revert: backfill any NULLs to '' so the NOT NULL restore
        // can't fail on existing rows.
        foreach ($this->columns as $column) {
            DB::table('invoice_settings')->whereNull($column)->update([$column => '']);
        }

        Schema::table('invoice_settings', function (Blueprint $table) {
            $table->string('issuer_name')->nullable(false)->change();
            $table->text('issuer_address')->nullable(false)->change();
            $table->string('invoice_title')->default('Rechnung')->nullable(false)->change();
            $table->text('footer_thanks')->nullable(false)->change();
            $table->text('footer_terms')->nullable(false)->change();
        });
    }
};
