<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\Models\UberPasskey;
use App\Domain\Dispatch\PasskeyService;
use App\Domain\Dispatch\UberAuthClient;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;

class RegisterUberPasskeys extends Command
{
    protected $signature = 'uber:register-passkeys {--tenant=* : Only these tenant ids} {--dry-run : List only} {--limit=5 : Max companies per run} {--sleep=60 : Seconds between companies}';

    protected $description = 'Register a software passkey on the Uber account of each eligible company (sequential, flag-gated, docs/29)';

    public function handle(PasskeyService $passkeys, UberAuthClient $uberAuth): int
    {
        $tenants = $this->candidates($passkeys);
        if ($tenants->isEmpty()) {
            $this->info('No eligible companies.');

            return self::SUCCESS;
        }
        if ($this->option('dry-run')) {
            $this->table(['tenant', 'name'], $tenants->map(fn (Tenant $t) => [$t->id, $t->name])->all());

            return self::SUCCESS;
        }

        $rows = [];
        foreach ($tenants as $i => $tenant) {
            $rows[] = [$tenant->id, $uberAuth->registerPasskey($tenant->id)['status'] ?? 'error'];
            if ($i < $tenants->count() - 1) {
                sleep(max(0, (int) $this->option('sleep')) + random_int(0, 10));
            }
        }
        $this->table(['tenant', 'outcome'], $rows);

        return self::SUCCESS;
    }

    /** @return Collection<int, Tenant> */
    private function candidates(PasskeyService $passkeys): Collection
    {
        $only = array_map('intval', (array) $this->option('tenant'));
        $withSession = UberFleetSession::withoutGlobalScopes()->where('status', UberFleetSession::STATUS_ACTIVE)->pluck('tenant_id');
        $withPasskey = UberPasskey::withoutGlobalScopes()->where('status', UberPasskey::STATUS_ACTIVE)->pluck('tenant_id');

        return Tenant::query()
            ->whereIn('id', $withSession)
            ->whereNotIn('id', $withPasskey)
            ->when($only !== [], fn ($q) => $q->whereIn('id', $only))
            ->get()
            ->filter(fn (Tenant $t) => $passkeys->isEnabledFor($t))
            ->take((int) $this->option('limit'))
            ->values();
    }
}
