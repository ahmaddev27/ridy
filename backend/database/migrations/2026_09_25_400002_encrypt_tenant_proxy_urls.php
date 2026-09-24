<?php

use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * tenants.proxy_url held a PLAINTEXT copy of the (encrypted) pool proxy URL,
 * credentials included — in the live DB and every nightly dump. Encrypt the
 * existing values in place. Idempotent: rows that already decrypt are skipped.
 * Row-by-row UPDATEs by primary key only (a handful of tenants), no DDL.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('tenants')->whereNotNull('proxy_url')->orderBy('id')
            ->chunkById(200, function ($rows) {
                foreach ($rows as $row) {
                    if ($row->proxy_url === '' || $this->isCiphertext((string) $row->proxy_url)) {
                        continue;
                    }
                    DB::table('tenants')->where('id', $row->id)
                        ->update(['proxy_url' => Crypt::encryptString((string) $row->proxy_url)]);
                }
            });
    }

    public function down(): void
    {
        DB::table('tenants')->whereNotNull('proxy_url')->orderBy('id')
            ->chunkById(200, function ($rows) {
                foreach ($rows as $row) {
                    try {
                        $plain = Crypt::decryptString((string) $row->proxy_url);
                    } catch (DecryptException) {
                        continue;
                    }
                    DB::table('tenants')->where('id', $row->id)->update(['proxy_url' => $plain]);
                }
            });
    }

    private function isCiphertext(string $value): bool
    {
        try {
            Crypt::decryptString($value);

            return true;
        } catch (DecryptException) {
            return false;
        }
    }
};
