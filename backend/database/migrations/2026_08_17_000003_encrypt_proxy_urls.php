<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * The `proxies.url` column carries embedded credentials
 * (http://user:pass@host:port) and is now stored via the model's `encrypted`
 * cast. Existing rows predate the cast and hold plaintext, which the cast would
 * fail to decrypt on read. Re-encrypt them in place here.
 *
 * We read the raw column through the query builder (bypassing the Eloquent
 * cast) and write back the encrypted value, guarding against double-encrypting
 * rows that are already ciphertext.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('proxies')->select('id', 'url')->orderBy('id')->each(function ($row): void {
            if ($row->url === null || $row->url === '') {
                return;
            }

            // Already encrypted? Then decrypt succeeds — leave it untouched.
            try {
                Crypt::decryptString($row->url);

                return;
            } catch (Throwable) {
                // Plaintext — fall through and encrypt it.
            }

            DB::table('proxies')
                ->where('id', $row->id)
                ->update(['url' => Crypt::encryptString($row->url)]);
        });
    }

    public function down(): void
    {
        // Best-effort: decrypt back to plaintext so a rollback leaves readable rows.
        DB::table('proxies')->select('id', 'url')->orderBy('id')->each(function ($row): void {
            if ($row->url === null || $row->url === '') {
                return;
            }

            try {
                $plain = Crypt::decryptString($row->url);
            } catch (Throwable) {
                return; // Not encrypted — nothing to undo.
            }

            DB::table('proxies')->where('id', $row->id)->update(['url' => $plain]);
        });
    }
};
