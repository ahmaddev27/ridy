<?php

namespace Tests\Feature;

use App\Console\Commands\DbBackup;
use App\Domain\Ops\Models\AlertIncident;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * db:backup must only keep provably complete dumps: the old
 * `mysqldump | gzip` pipeline took gzip's exit status, so a dump that died
 * mid-way was accepted as a good backup.
 */
class DbBackupTest extends TestCase
{
    use RefreshDatabase;

    private string $storage;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storage = sys_get_temp_dir().'/reidey-backup-test-'.uniqid();
        File::ensureDirectoryExists($this->storage.'/app');
        $this->app->useStoragePath($this->storage);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->storage);
        parent::tearDown();
    }

    private function useFakeDump(string $mode): void
    {
        config(['database.backup.dump_command' => [PHP_BINARY, base_path('tests/Fixtures/fake-mysqldump.php'), $mode]]);
    }

    /** @return list<string> */
    private function files(): array
    {
        return glob($this->storage.'/app/backups/*') ?: [];
    }

    public function test_a_complete_dump_is_kept_and_excludes_transient_table_data(): void
    {
        $this->useFakeDump('complete');

        $this->artisan('db:backup')->assertSuccessful();

        $files = $this->files();
        $this->assertCount(1, $files);
        $this->assertMatchesRegularExpression('#/ridy-[\d_-]+\.sql\.gz$#', $files[0]);

        $sql = (string) gzdecode((string) file_get_contents($files[0]));
        $this->assertStringContainsString('-- Dump completed', $sql);
        $this->assertStringContainsString('--ignore-table=', $sql);
        $this->assertStringContainsString('.dispatch_network_logs', $sql);
        // The transient tables are still recreated on restore (structure only).
        $this->assertStringContainsString('--no-data', $sql);
    }

    public function test_a_truncated_dump_is_rejected_and_alerts(): void
    {
        $this->useFakeDump('truncated');

        $this->artisan('db:backup')->assertFailed();

        $this->assertSame([], $this->files(), 'No partial or truncated file may be left behind.');
        $this->assertTrue(AlertIncident::where('key', DbBackup::ALERT_KEY)->whereNull('resolved_at')->exists());
    }

    public function test_a_failed_dump_is_rejected_and_old_backups_survive(): void
    {
        File::ensureDirectoryExists($this->storage.'/app/backups');
        $old = $this->storage.'/app/backups/ridy-2026-01-01_030000.sql.gz';
        file_put_contents($old, gzencode("-- Dump completed\n"));
        touch($old, now()->subDays(30)->getTimestamp());

        $this->useFakeDump('fail');

        $this->artisan('db:backup')->assertFailed();

        $this->assertSame([$old], $this->files(), 'A failed run must not prune existing backups.');
    }

    public function test_a_good_backup_resolves_a_previous_failure_alert(): void
    {
        $this->useFakeDump('fail');
        $this->artisan('db:backup')->assertFailed();

        $this->useFakeDump('complete');
        $this->artisan('db:backup')->assertSuccessful();

        $this->assertFalse(AlertIncident::where('key', DbBackup::ALERT_KEY)->whereNull('resolved_at')->exists());
    }
}
