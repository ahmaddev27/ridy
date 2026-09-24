<?php

namespace App\Support;

use Closure;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Index DDL for large, hot tables without stalling live traffic.
 *
 * On MySQL an ADD INDEX is INPLACE/LOCK=NONE but still needs a brief exclusive
 * metadata lock; with the default lock_wait_timeout (1 year) a migration queued
 * behind a long reader freezes every later statement on the table — offer ingest
 * included. Here the ALTER pins ALGORITHM=INPLACE, LOCK=NONE (fail fast instead of
 * silently falling back to a blocking COPY) and waits at most 10 s for the lock.
 * SQLite (tests) goes through the schema builder.
 */
final class OnlineDdl
{
    private const LOCK_WAIT_SECONDS = 10;

    /** @param array<int, string> $columns */
    public static function addIndex(string $table, string $name, array $columns): void
    {
        if (! self::isMysql()) {
            Schema::table($table, fn (Blueprint $t) => $t->index($columns, $name));

            return;
        }

        $cols = implode(', ', array_map(fn (string $c) => '`'.str_replace('`', '', $c).'`', $columns));
        self::alter($table, "ADD INDEX `{$name}` ({$cols})");
    }

    /**
     * Append a column as a metadata-only change (ALGORITHM=INSTANT on MySQL 8), with
     * the same bounded lock wait. `$definition` is the MySQL column definition, e.g.
     * "`anonymized_at` TIMESTAMP NULL"; `$blueprint` builds it for SQLite.
     *
     * @param  Closure(Blueprint): void  $blueprint
     */
    public static function addColumn(string $table, string $definition, Closure $blueprint): void
    {
        if (! self::isMysql()) {
            Schema::table($table, $blueprint);

            return;
        }

        self::alter($table, "ADD COLUMN {$definition}", 'ALGORITHM=INSTANT');
    }

    public static function dropIndex(string $table, string $name): void
    {
        if (! self::isMysql()) {
            Schema::table($table, fn (Blueprint $t) => $t->dropIndex($name));

            return;
        }

        self::alter($table, "DROP INDEX `{$name}`");
    }

    private static function alter(string $table, string $clause, string $algorithm = 'ALGORITHM=INPLACE, LOCK=NONE'): void
    {
        $previous = (int) (DB::selectOne('SELECT @@SESSION.lock_wait_timeout AS t')->t ?? 31536000);
        DB::statement('SET SESSION lock_wait_timeout = '.self::LOCK_WAIT_SECONDS);

        try {
            DB::statement("ALTER TABLE `{$table}` {$clause}, {$algorithm}");
        } finally {
            // Later migrations in the same run keep the server's own setting.
            DB::statement('SET SESSION lock_wait_timeout = '.$previous);
        }
    }

    private static function isMysql(): bool
    {
        return in_array(DB::connection()->getDriverName(), ['mysql', 'mariadb'], true);
    }
}
