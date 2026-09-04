<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The single-row invoice template the super-admin edits: issuer identity, bank
 * details, branding and VAT posture used to render every subscription invoice.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoice_settings', function (Blueprint $table) {
            $table->id();
            $table->string('issuer_name');
            $table->text('issuer_address');
            $table->string('issuer_tax_id')->nullable();
            $table->string('issuer_email')->nullable();
            $table->string('issuer_phone')->nullable();
            $table->string('issuer_website')->nullable();
            $table->string('bank_iban')->nullable();
            $table->string('bank_bic')->nullable();
            $table->string('bank_name')->nullable();
            $table->string('logo_url')->nullable();
            $table->string('accent_color', 9)->default('#0e6b4e');
            $table->string('invoice_title')->default('Rechnung');
            $table->string('number_prefix', 12)->default('RE');
            $table->decimal('vat_rate', 5, 2)->default(19.00);
            $table->boolean('kleinunternehmer')->default(false);
            $table->string('currency', 8)->default('EUR');
            $table->string('header_note')->nullable();
            $table->text('footer_thanks');
            $table->text('footer_terms');
            $table->timestamps();
        });

        // Seed the singleton with the German defaults shown in the approved design.
        DB::table('invoice_settings')->insert([
            'id' => 1,
            'issuer_name' => 'Reidey GmbH',
            'issuer_address' => "Friedrich-Ebert-Straße 8\n42103 Wuppertal\nDeutschland",
            'issuer_tax_id' => 'DE 123 456 789',
            'issuer_email' => 'billing@reidey.de',
            'issuer_phone' => '+49 202 000 000',
            'issuer_website' => 'reidey.de',
            'bank_iban' => 'DE00 0000 0000 0000 00',
            'bank_bic' => 'WELADEDXXX',
            'bank_name' => 'Stadtsparkasse Wuppertal',
            'logo_url' => null,
            'accent_color' => '#0e6b4e',
            'invoice_title' => 'Rechnung',
            'number_prefix' => 'RE',
            'vat_rate' => 19.00,
            'kleinunternehmer' => false,
            'currency' => 'EUR',
            'header_note' => 'Flotten-Dispatch',
            'footer_thanks' => 'Vielen Dank für Ihr Vertrauen in Reidey.',
            'footer_terms' => 'Der Betrag wurde per Aktivierungscode vollständig beglichen — diese Rechnung dient als Zahlungsbeleg. Bei Fragen zur Rechnung erreichen Sie uns unter billing@reidey.de.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_settings');
    }
};
