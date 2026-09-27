<?php

namespace App\Console\Commands;

use App\Domain\Ops\AlertService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use RuntimeException;
use Symfony\Component\Process\Process;
use Throwable;

/**
 * Nightly logical backup of the MySQL database to a gzipped dump, kept on disk
 * (storage/app/backups, which is bind-mounted so it survives container
 * recreation) with a rolling retention window. Restore + offsite copy steps are
 * documented in docs/20-backup-and-alerts.md.
 *
 * A backup is only accepted when it is provably complete: mysqldump runs
 * without a shell (its own exit code, not a pipe's last stage), every part must
 * end with mysqldump's "-- Dump completed" trailer, and the archive is written
 * to a .partial file that is renamed only after all checks pass. The old
 * `mysqldump | gzip` pipeline reported gzip's exit status, so a dump that died
 * half-way was logged as "Backup written" and could rotate out every good copy.
 */
class DbBackup extends Command
{
    public const ALERT_KEY = 'backup.failed';

    private const COMPLETE_MARKER = '-- Dump completed';

    protected $signature = 'db:backup {--keep=7 : Days of backups to retain}';

    protected $description = 'Dump the database to a gzipped file and prune old backups';

    public function handle(AlertService $alerts): int
    {
        $dir = storage_path('app/backups');
        if (! is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        $file = $dir.'/ridy-'.now()->format('Y-m-d_His').'.sql.gz';
        $parts = [$file.'.data.sql'];
        if ($this->schemaOnlyTables() !== []) {
            $parts[] = $file.'.schema.sql';
        }

        try {
            $this->dumpData($parts[0]);
            if (isset($parts[1])) {
                $this->dumpSchemaOnlyTables($parts[1]);
            }
            $this->compress($parts, $file.'.partial');
            rename($file.'.partial', $file);
        } catch (Throwable $e) {
            @unlink($file.'.partial');
            $this->error('Backup failed: '.$e->getMessage());
            $alerts->open(self::ALERT_KEY, 'backup', 'Database backup failed', $e->getMessage());

            return self::FAILURE;
        } finally {
            array_map(fn (string $part) => @unlink($part), $parts);
        }

        $this->info('Backup written: '.basename($file).' ('.number_format(filesize($file) / 1024, 1).' KB)');
        $alerts->resolve(self::ALERT_KEY);
        $this->prune((int) $this->option('keep'), $file);

        return self::SUCCESS;
    }

    /** Full dump of every table's structure + data, minus the schema-only tables' rows. */
    private function dumpData(string $resultFile): void
    {
        $db = $this->connection();
        $ignored = array_map(
            fn (string $table): string => '--ignore-table='.$db['database'].'.'.$table,
            $this->schemaOnlyTables(),
        );

        $this->runDump([
            '--single-transaction', '--quick', '--routines', '--triggers',
            ...$ignored,
            $db['database'],
        ], $resultFile);
    }

    /** Structure only for the transient tables, so a restore still recreates them. */
    private function dumpSchemaOnlyTables(string $resultFile): void
    {
        $this->runDump(
            ['--no-data', '--skip-triggers', $this->connection()['database'], ...$this->schemaOnlyTables()],
            $resultFile,
        );
    }

    /** @param  list<string>  $args */
    private function runDump(array $args, string $resultFile): void
    {
        $db = $this->connection();

        // Array form: no shell, so the exit code is mysqldump's own. The password
        // goes via env so it never shows in the process list.
        $process = new Process([
            ...(array) config('database.backup.dump_command', ['mysqldump']),
            '-h'.$db['host'],
            '-P'.$db['port'],
            '-u'.$db['username'],
            '--result-file='.$resultFile,
            ...$args,
        ], env: ['MYSQL_PWD' => (string) $db['password']], timeout: 1800);

        $process->run();

        if (! $process->isSuccessful()) {
            throw new RuntimeException(trim($process->getErrorOutput()) ?: 'mysqldump exited with code '.$process->getExitCode());
        }

        if (! $this->endsWithCompletionMarker($resultFile)) {
            throw new RuntimeException('Dump is truncated: '.basename($resultFile).' has no "'.self::COMPLETE_MARKER.'" trailer.');
        }
    }

    /** mysqldump writes "-- Dump completed on …" as the very last line of a finished dump. */
    private function endsWithCompletionMarker(string $path): bool
    {
        $size = is_file($path) ? (int) filesize($path) : 0;
        if ($size === 0) {
            return false;
        }

        $handle = fopen($path, 'rb');
        if ($handle === false) {
            return false;
        }

        try {
            fseek($handle, max(0, $size - 512));
            $tail = (string) fread($handle, 512);
        } finally {
            fclose($handle);
        }

        return str_contains($tail, self::COMPLETE_MARKER);
    }

    /** @param  list<string>  $parts */
    private function compress(array $parts, string $target): void
    {
        $out = gzopen($target, 'wb6');
        if ($out === false) {
            throw new RuntimeException('Cannot open '.basename($target).' for writing.');
        }

        try {
            foreach ($parts as $part) {
                $in = fopen($part, 'rb');
                if ($in === false) {
                    throw new RuntimeException('Cannot read '.basename($part).'.');
                }
                try {
                    while (! feof($in)) {
                        $chunk = (string) fread($in, 1 << 20);
                        if ($chunk !== '' && gzwrite($out, $chunk) === false) {
                            throw new RuntimeException('Writing the compressed backup failed (disk full?).');
                        }
                    }
                } finally {
                    fclose($in);
                }
            }
        } finally {
            if (! gzclose($out)) {
                throw new RuntimeException('Finalising the compressed backup failed.');
            }
        }
    }

    /**
     * Delete backups older than the retention window. Runs only after a
     * verified backup, and never deletes the one just written.
     */
    private function prune(int $keepDays, string $justWritten): void
    {
        $cutoff = Carbon::now()->subDays(max(1, $keepDays));
        foreach (glob(storage_path('app/backups').'/ridy-*.sql.gz') ?: [] as $path) {
            if ($path !== $justWritten && Carbon::createFromTimestamp(filemtime($path))->lessThan($cutoff)) {
                @unlink($path);
            }
        }
    }

    /** @return list<string> */
    private function schemaOnlyTables(): array
    {
        return array_values((array) config('database.backup.schema_only_tables', []));
    }

    /** @return array<string, mixed> */
    private function connection(): array
    {
        return (array) config('database.connections.mysql');
    }
}
