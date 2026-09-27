<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Issued invoices and cash-ledger rows are accounting records (§147 AO / GoBD,
 * 10-year retention), so the database itself must refuse to delete them as a side
 * effect. The FKs that used to CASCADE (tenant → invoices / payments, collector →
 * payments) or silently NULL a settling payment become RESTRICT; the admin
 * endpoints answer 409/422 with a clear reason before the DB would refuse.
 *
 * The existing FK is looked up by column (not by an assumed name), so a schema
 * restored from backup with differently named constraints still migrates.
 */
return new class extends Migration
{
    /** @var array<int, array{0: string, 1: string, 2: string}> [table, column, referenced table] */
    private const KEYS = [
        ['subscription_periods', 'tenant_id', 'tenants'],
        ['subscription_periods', 'collector_payment_id', 'collector_payments'],
        ['collector_payments', 'tenant_id', 'tenants'],
        ['collector_payments', 'collector_id', 'collectors'],
    ];

    public function up(): void
    {
        foreach (self::KEYS as [$table, $column, $references]) {
            $this->replace($table, $column, $references, 'restrict');
        }
    }

    public function down(): void
    {
        $this->replace('subscription_periods', 'tenant_id', 'tenants', 'cascade');
        $this->replace('subscription_periods', 'collector_payment_id', 'collector_payments', 'set null');
        $this->replace('collector_payments', 'tenant_id', 'tenants', 'cascade');
        $this->replace('collector_payments', 'collector_id', 'collectors', 'cascade');
    }

    private function replace(string $table, string $column, string $references, string $onDelete): void
    {
        $existing = collect(Schema::getForeignKeys($table))
            ->first(fn (array $fk) => $fk['columns'] === [$column]);

        if ($existing !== null && strtolower((string) $existing['on_delete']) === $onDelete) {
            return; // already in the wanted state — keeps the migration re-runnable
        }

        Schema::table($table, function (Blueprint $blueprint) use ($existing, $column, $references, $onDelete) {
            if ($existing !== null) {
                // By name where the driver reports one (MySQL); by column otherwise (SQLite).
                $blueprint->dropForeign(filled($existing['name'] ?? null) ? $existing['name'] : [$column]);
            }
            $blueprint->foreign($column)->references('id')->on($references)->onDelete($onDelete);
        });
    }
};
