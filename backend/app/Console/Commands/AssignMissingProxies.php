<?php

namespace App\Console\Commands;

use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\ProxyPool;
use Illuminate\Console\Command;

class AssignMissingProxies extends Command
{
    protected $signature = 'proxies:assign-missing {--dry-run : Report how many would be assigned without writing}';

    protected $description = 'Place every usable company that has no proxy onto a pool proxy with free capacity';

    public function handle(ProxyPool $pool): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $missing = Tenant::usable()->whereNull('proxy_id')->count();
        $assigned = $pool->assignMissing($dryRun);

        $this->info(($dryRun ? 'Would assign ' : 'Assigned ').$assigned.' of '.$missing.' companies without a proxy.');
        if ($missing > $assigned) {
            $this->warn(($missing - $assigned).' skipped: pool full/empty (add a proxy or raise capacity).');
        }
        $this->line('Verify the proxy exits in DE and is not expired before relying on this.');

        return self::SUCCESS;
    }
}
