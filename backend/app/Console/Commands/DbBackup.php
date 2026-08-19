<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Symfony\Component\Process\Process;

/**
 * Nightly logical backup of the MySQL database to a gzipped dump, kept on disk
 * (storage/app/backups, which is bind-mounted so it survives container
 * recreation) with a rolling retention window. Restore + offsite copy steps are
 * documented in docs/20-backup-and-alerts.md.
 */
class DbBackup extends Command
{
    protected $signature = 'db:backup {--keep=7 : Days of backups to retain}';

    protected $description = 'Dump the database to a gzipped file and prune old backups';

    public function handle(): int
    {
        $db = config('database.connections.mysql');
        $dir = storage_path('app/backups');
        if (! is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        $file = $dir.'/ridy-'.now()->format('Y-m-d_His').'.sql.gz';

        // mysqldump piped through gzip. --single-transaction gives a consistent
        // snapshot without locking; the password goes via env so it never shows
        // in the process list.
        $cmd = sprintf(
            'mysqldump --single-transaction --quick --routines --triggers -h%s -P%s -u%s %s | gzip > %s',
            escapeshellarg((string) $db['host']),
            escapeshellarg((string) $db['port']),
            escapeshellarg((string) $db['username']),
            escapeshellarg((string) $db['database']),
            escapeshellarg($file),
        );

        $process = Process::fromShellCommandline($cmd, timeout: 1800, env: [
            'MYSQL_PWD' => (string) $db['password'],
        ]);
        $process->run();

        if (! $process->isSuccessful() || ! is_file($file) || filesize($file) < 100) {
            @unlink($file);
            $this->error('Backup failed: '.$process->getErrorOutput());

            return self::FAILURE;
        }

        $this->info('Backup written: '.basename($file).' ('.number_format(filesize($file) / 1024, 1).' KB)');
        $this->prune((int) $this->option('keep'));

        return self::SUCCESS;
    }

    /** Delete backups older than the retention window. */
    private function prune(int $keepDays): void
    {
        $cutoff = Carbon::now()->subDays(max(1, $keepDays));
        foreach (glob(storage_path('app/backups').'/ridy-*.sql.gz') ?: [] as $path) {
            if (Carbon::createFromTimestamp(filemtime($path))->lessThan($cutoff)) {
                @unlink($path);
            }
        }
    }
}
