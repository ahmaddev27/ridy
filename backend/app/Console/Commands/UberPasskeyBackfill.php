<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\Models\UberPasskey;
use App\Domain\Dispatch\PasskeyService;
use App\Domain\Dispatch\UberAuthClient;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;

/**
 * Explicit, operator-run passkey registration (docs/29). Never scheduled, never run by a
 * deploy. DRY-RUN unless --run; one tenant with --tenant=ID; fleet-wide additionally
 * needs --confirm. A `session_lost` outcome halts the whole run.
 */
class UberPasskeyBackfill extends Command
{
    protected $signature = 'uber:passkey-backfill
        {--tenant= : Register for exactly this tenant id}
        {--run : Actually register (default is a dry run that only lists)}
        {--confirm : Required with --run when no --tenant is given (fleet-wide)}
        {--limit=5 : Max companies per fleet-wide run}
        {--sleep=60 : Seconds between companies}';

    protected $description = 'Register a software passkey on eligible companies\' Uber accounts (dry-run by default, flag-gated, docs/29)';

    public function handle(PasskeyService $passkeys, UberAuthClient $uberAuth): int
    {
        $run = (bool) $this->option('run');
        $tenantId = $this->option('tenant');
        if ($run && $tenantId === null && ! $this->option('confirm')) {
            $this->error('Refusing to run fleet-wide: pass --tenant=ID, or add --confirm.');

            return self::FAILURE;
        }

        $tenants = $this->candidates($passkeys, $tenantId === null ? null : (int) $tenantId);
        if ($tenants->isEmpty()) {
            $this->info('No eligible companies (needs both passkey flags ON, an active session and no passkey yet).');

            return self::SUCCESS;
        }
        if (! $run) {
            $this->table(['tenant', 'name'], $tenants->map(fn (Tenant $t) => [$t->id, $t->name])->all());
            $this->warn('Dry run - nothing was registered. Add --run to register.');

            return self::SUCCESS;
        }
        if (! $uberAuth->configured()) {
            $this->error('Browser service (uber-auth) is not configured.');

            return self::FAILURE;
        }

        return $this->registerAll($tenants, $uberAuth);
    }

    /** @param Collection<int, Tenant> $tenants */
    private function registerAll(Collection $tenants, UberAuthClient $uberAuth): int
    {
        $rows = [];
        $exit = self::SUCCESS;
        foreach ($tenants->values() as $i => $tenant) {
            $status = (string) ($uberAuth->registerPasskey($tenant->id)['status'] ?? 'error');
            $rows[] = [$tenant->id, $status];
            if ($status === 'session_lost') {
                $this->error("Tenant {$tenant->id} lost its Uber session - halting the run.");
                $exit = self::FAILURE;
                break;
            }
            if ($i < $tenants->count() - 1) {
                sleep(max(0, (int) $this->option('sleep')) + random_int(0, 10));
            }
        }
        $this->table(['tenant', 'outcome'], $rows);

        return $exit;
    }

    /** @return Collection<int, Tenant> */
    private function candidates(PasskeyService $passkeys, ?int $only): Collection
    {
        $withSession = UberFleetSession::withoutGlobalScopes()->where('status', UberFleetSession::STATUS_ACTIVE)->pluck('tenant_id');
        $withPasskey = UberPasskey::withoutGlobalScopes()->where('status', UberPasskey::STATUS_ACTIVE)->pluck('tenant_id');

        return Tenant::query()
            ->whereIn('id', $withSession)
            ->whereNotIn('id', $withPasskey)
            ->when($only !== null, fn ($q) => $q->where('id', $only))
            ->get()
            ->filter(fn (Tenant $t) => $passkeys->isEnabledFor($t))
            ->take($only !== null ? 1 : max(1, (int) $this->option('limit')))
            ->values();
    }
}
