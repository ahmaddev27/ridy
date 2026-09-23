<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Detect a SILENTLY stalled offer stream: an active company whose driver-status
 * sync is provably LIVE (we're polling and see online, available drivers right
 * now) and which normally receives offers, yet no offer has arrived for a while.
 * That is the shape of a RAMEN stream that stopped delivering while the session
 * still looks healthy — the class of problem a driver only notices as "Uber has
 * offers but Reidey doesn't", with nothing surfaced today.
 *
 * Observability only — it writes a log line (admin Logs tab), never changes
 * behavior. It deliberately requires FRESH status sync so it does not overlap
 * with {@see CheckFleetSync} (the sync-dead case), and requires at least one
 * online-and-IDLE driver so a fleet that is simply all-busy or all-offline is not
 * flagged. A genuine low-demand lull can still trip it; the logged
 * available_drivers + last_offer let an admin tell a lull from a real stall by
 * cross-checking the daemon logs.
 */
class CheckOfferFlow extends Command
{
    protected $signature = 'fleet:check-offer-flow';

    protected $description = 'Log companies whose offer stream looks stalled (idle drivers online, no offers arriving).';

    /** No offer received within this window, while drivers are available, = suspicious. */
    private const OFFER_STALE_MINUTES = 25;

    /** A driver's status is only trusted as "online now" if synced this recently. */
    private const FRESH_STATUS_MINUTES = 5;

    public function handle(): int
    {
        $offerCutoff = now()->subMinutes(self::OFFER_STALE_MINUTES);
        $statusCutoff = now()->subMinutes(self::FRESH_STATUS_MINUTES);
        $flagged = 0;

        foreach (Tenant::query()->get() as $tenant) {
            if ($tenant->stateReason() !== null) {
                continue; // only companies we actually serve
            }

            // Drivers who SHOULD be getting offers right now: online, idle (not on a
            // job), and with a fresh status so we know they are genuinely online.
            $available = Driver::withoutGlobalScopes()
                ->where('tenant_id', $tenant->id)
                ->whereNotNull('uber_driver_uuid')
                ->where('status_synced_at', '>=', $statusCutoff)
                ->online()
                ->idle() // engagement 0: online and not EN_ROUTE/ON_TRIP, now index-served
                ->count();
            if ($available === 0) {
                continue; // all busy/offline, or sync not fresh — nothing to expect
            }

            // Only fleets that normally receive offers (a stall follows real traffic).
            $lastOffer = DispatchOffer::withoutGlobalScopes()
                ->where('tenant_id', $tenant->id)
                ->max('received_at');
            if ($lastOffer === null || $lastOffer >= $offerCutoff) {
                continue; // never active, or offers are still flowing
            }

            $flagged++;
            Log::warning('fleet.offer_flow_stale', [
                'tenant' => $tenant->id,
                'company' => $tenant->name,
                'available_drivers' => $available,
                'last_offer' => (string) $lastOffer,
                'stale_for_minutes' => '>='.self::OFFER_STALE_MINUTES,
            ]);
        }

        $this->info("Checked offer flow — {$flagged} company(ies) look stalled.");

        return self::SUCCESS;
    }
}
