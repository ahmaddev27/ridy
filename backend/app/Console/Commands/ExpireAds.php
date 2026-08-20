<?php

namespace App\Console\Commands;

use App\Domain\Ads\Models\Ad;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

/**
 * Deactivates ads whose scheduled end time has passed. scopeLive already hides
 * them from companies the moment they expire; this flips the stored `active`
 * flag off too, so the admin list reflects reality instead of showing a
 * still-"Active" ad that no company can see.
 */
class ExpireAds extends Command
{
    protected $signature = 'ads:expire';

    protected $description = 'Deactivate ads whose end time has passed';

    public function handle(): int
    {
        $count = Ad::query()
            ->where('active', true)
            ->whereNotNull('ends_at')
            ->where('ends_at', '<', Carbon::now())
            ->update(['active' => false]);

        $this->info("Deactivated {$count} expired ad(s).");

        return self::SUCCESS;
    }
}
