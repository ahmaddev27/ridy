<?php

namespace App\Console\Commands;

use App\Domain\Fleet\Models\Driver;
use Illuminate\Console\Command;

/**
 * Dumps every driver's login email so they can be pasted into the Google Play /
 * TestFlight tester list. Comma-separated by default (Play's "Add email
 * addresses" field); --csv prints one per line for a CSV upload.
 */
class ExportDriverEmails extends Command
{
    protected $signature = 'drivers:emails {--csv : one email per line (for CSV upload)}';

    protected $description = 'Export all driver emails for the app-store tester list';

    public function handle(): int
    {
        $emails = Driver::withoutGlobalScopes()
            ->whereNotNull('email')
            ->where('email', '!=', '')
            ->orderBy('email')
            ->pluck('email')
            ->unique()
            ->values();

        if ($emails->isEmpty()) {
            $this->warn('No driver emails on file.');

            return self::SUCCESS;
        }

        // Plain output (no INFO prefix) so it copy-pastes clean.
        $this->line($this->option('csv') ? $emails->implode("\n") : $emails->implode(','));

        $this->newLine();
        $this->info("{$emails->count()} email(s).");

        return self::SUCCESS;
    }
}
