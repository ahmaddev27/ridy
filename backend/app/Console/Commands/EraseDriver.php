<?php

namespace App\Console\Commands;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Privacy\DriverEraser;
use Illuminate\Console\Command;

/**
 * Erase one driver's personal data on request (DSGVO Art. 17) — see
 * {@see DriverEraser}. Requires the driver's company id as a guard against a
 * mistyped driver id hitting the wrong fleet.
 */
class EraseDriver extends Command
{
    protected $signature = 'drivers:erase {driver : Driver id} {--tenant= : The driver\'s company id (required)} {--force : Skip the confirmation}';

    protected $description = 'Erase a single driver (tokens, devices, metrics, OTPs) and anonymize/unlink their offers.';

    public function handle(DriverEraser $eraser): int
    {
        $tenantId = (int) $this->option('tenant');
        if ($tenantId <= 0) {
            $this->error('Pass --tenant=<company id>.');

            return self::INVALID;
        }

        $driver = Driver::withoutGlobalScopes()
            ->whereKey((int) $this->argument('driver'))
            ->where('tenant_id', $tenantId)
            ->first();
        if ($driver === null) {
            $this->error('No such driver in that company.');

            return self::FAILURE;
        }

        if ($driver->roster_removed_at === null && filled($driver->uber_driver_uuid)) {
            $this->warn('This driver is still on the company\'s Uber roster — the next roster sync re-creates them. Remove them in Uber first.');
        }

        if (! $this->option('force') && ! $this->confirm("Erase driver #{$driver->id} ({$driver->name}) permanently?")) {
            return self::FAILURE;
        }

        $counts = $eraser->erase($driver);

        $this->table(['entity', 'rows'], collect($counts)->map(fn ($n, $k) => [$k, $n])->values()->all());

        return self::SUCCESS;
    }
}
