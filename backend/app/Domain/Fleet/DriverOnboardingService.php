<?php

namespace App\Domain\Fleet;

use App\Domain\Fleet\Models\Driver;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * What happens to the driver rows a roster sync touched: first adopt an account
 * from a previous company (any account-less row, see DriverAccountTransferService
 * for why not only new ones), then invite the rows the sync CREATED.
 * Transfer must run first, because inviting would claim an email the old row
 * still holds and fail with a 422.
 *
 * Runs inside the roster-sync hot path, so nothing here may ever propagate.
 */
class DriverOnboardingService
{
    public function __construct(
        private readonly DriverAccountTransferService $transfer,
        private readonly DriverInvitationService $invitations,
    ) {}

    /**
     * @param  Collection<int, Driver>  $touched  every row the sync created or updated
     * @param  array<int, int>  $createdIds  ids of the rows it created
     */
    public function onboard(Collection $touched, array $createdIds): void
    {
        try {
            $this->transfer->transferMany($touched);
        } catch (Throwable $e) {
            Log::warning('driver.onboarding_transfer_failed', ['error' => $e->getMessage()]);
        }

        foreach ($touched->whereIn('id', $createdIds) as $driver) {
            $this->inviteIfEligible($driver);
        }
    }

    private function inviteIfEligible(Driver $driver): void
    {
        // After a transfer the row is activated, and inviting would reset a working login.
        if ($driver->activated_at !== null || $driver->invited_at !== null || ! $driver->canBeInvited()) {
            return;
        }

        try {
            $this->invitations->invite($driver);
        } catch (Throwable $e) {
            Log::warning('driver.auto_invite_failed', ['driver_id' => $driver->id, 'error' => $e->getMessage()]);
        }
    }
}
