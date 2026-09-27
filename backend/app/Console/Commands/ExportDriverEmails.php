<?php

namespace App\Console\Commands;

use App\Domain\Audit\AuditLogger;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Console\Command;

/**
 * Dumps the login emails of drivers who ACTIVATED the app, so they can be pasted
 * into the Google Play / TestFlight tester list. Comma-separated by default
 * (Play's "Add email addresses" field); --csv prints one per line.
 *
 * Reidey holds driver data as each fleet's processor, so the export is scoped:
 * one company (--tenant=ID, the fleet that asked for app-store distribution) or
 * an explicit --all-tenants. Never-invited drivers' Uber-captured emails,
 * drivers off the roster and drivers of lapsed companies are not exported, and
 * each run is written to the audit log.
 */
class ExportDriverEmails extends Command
{
    protected $signature = 'drivers:emails
        {--tenant= : Only this company (id)}
        {--all-tenants : Every usable company (explicit opt-in)}
        {--csv : one email per line (for CSV upload)}';

    protected $description = 'Export activated drivers\' login emails for the app-store tester list';

    public function handle(AuditLogger $audit): int
    {
        $tenantId = $this->option('tenant') !== null ? (int) $this->option('tenant') : null;
        if ($tenantId === null && ! $this->option('all-tenants')) {
            $this->error('Pass --tenant=<id> or --all-tenants.');

            return self::INVALID;
        }

        $emails = Driver::withoutGlobalScopes()
            ->whereNotNull('activated_at')
            ->whereNull('roster_removed_at')
            ->whereNotNull('email')
            ->whereIn('tenant_id', Tenant::query()->usable()->select('id'))
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->pluck('email')
            ->filter()
            ->unique()
            ->sort()
            ->values();

        $audit->logPlatform('drivers.emails_exported', null, [
            'tenant_id' => $tenantId,
            'all_tenants' => $tenantId === null,
            'count' => $emails->count(),
            'os_user' => get_current_user(),
        ]);

        if ($emails->isEmpty()) {
            $this->warn('No activated driver emails in scope.');

            return self::SUCCESS;
        }

        // Plain output (no INFO prefix) so it copy-pastes clean.
        $this->line($this->option('csv') ? $emails->implode("\n") : $emails->implode(','));

        $this->newLine();
        $this->info("{$emails->count()} email(s).");

        return self::SUCCESS;
    }
}
