<?php

namespace App\Console\Commands;

use App\Domain\Tenancy\ProxyPool;
use Illuminate\Console\Command;

class ResyncProxyUrls extends Command
{
    protected $signature = 'proxies:resync-urls';

    protected $description = 'Re-copy every proxy URL verbatim to the companies assigned to it';

    public function handle(ProxyPool $pool): int
    {
        $this->info('Synced '.$pool->resyncUrls().' company proxy URLs.');

        return self::SUCCESS;
    }
}
