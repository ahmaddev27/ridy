<?php

namespace App\Console\Commands;

use App\Casts\EncryptedWithPlaintextFallback;
use Illuminate\Console\Command;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * Encrypts the plaintext copies left in tenants.proxy_url (credentials included).
 *
 * Deliberately NOT a migration: `migrate` runs while the previous release still
 * serves the daemon, and a failed deploy restores that release without reversing
 * migrations — code without the {@see EncryptedWithPlaintextFallback} cast would
 * then hand ciphertext to the daemon as the proxy URL and break every proxied
 * stream. Run it once the release is confirmed; before rolling back to a release
 * without the cast, run it with --revert.
 *
 * Idempotent both ways: rows already in the target form are skipped. Row-by-row
 * UPDATEs by primary key on a small table.
 */
class EncryptTenantProxyUrls extends Command
{
    protected $signature = 'tenants:encrypt-proxy-urls
        {--revert : Decrypt back to plaintext (before rolling back to a release without the fallback cast)}';

    protected $description = 'Encrypt (or with --revert decrypt) the stored tenant proxy URLs.';

    public function handle(): int
    {
        $revert = (bool) $this->option('revert');
        $changed = 0;

        DB::table('tenants')->whereNotNull('proxy_url')->where('proxy_url', '!=', '')
            ->select(['id', 'proxy_url'])->orderBy('id')
            ->chunkById(200, function ($rows) use ($revert, &$changed) {
                foreach ($rows as $row) {
                    $stored = (string) $row->proxy_url;
                    $plain = $this->decrypt($stored);

                    $target = match (true) {
                        $revert && $plain !== null => $plain,
                        ! $revert && $plain === null => Crypt::encryptString($stored),
                        default => null, // already in the target form
                    };

                    if ($target !== null) {
                        DB::table('tenants')->where('id', $row->id)->update(['proxy_url' => $target]);
                        $changed++;
                    }
                }
            });

        $this->info(($revert ? 'Decrypted' : 'Encrypted')." {$changed} tenant proxy URL(s).");

        return self::SUCCESS;
    }

    private function decrypt(string $value): ?string
    {
        try {
            return Crypt::decryptString($value);
        } catch (DecryptException) {
            return null;
        }
    }
}
