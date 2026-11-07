<?php

namespace App\Console\Commands;

use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Console\Command;

/** Turns the uber-auth device-hygiene dry-run on or off for ONE company. */
class SetSessionHygiene extends Command
{
    protected $signature = 'session-hygiene:set {tenant : Tenant id} {state : on|off}';

    protected $description = 'Enable or disable the device-hygiene pass for one company';

    public function handle(): int
    {
        $state = strtolower((string) $this->argument('state'));
        if (! in_array($state, ['on', 'off'], true)) {
            $this->error('State must be "on" or "off".');

            return self::INVALID;
        }

        $tenant = Tenant::find($this->argument('tenant'));
        if ($tenant === null) {
            $this->error('Tenant not found.');

            return self::FAILURE;
        }

        $tenant->setSessionHygiene($state === 'on');
        $this->info("Session hygiene for tenant {$tenant->id}: {$state}.");

        return self::SUCCESS;
    }
}
