<?php

namespace App\Domain\Fleet;

use App\Domain\Audit\AuditLogger;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Models\DeviceToken;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Moves a driver's app account (login, devices, sessions) to their new company
 * when they change fleet. drivers.uber_driver_uuid is not unique, so a move
 * makes the new company's roster create a SECOND row while the old row keeps the
 * email: the driver would keep logging into the old company and never receive
 * the new one's offers.
 *
 * Only the ACCOUNT moves. Offers, driver_metrics, elprofessor_submissions and
 * every other record stay on the old row: they are the old company's business
 * records, not something the driver takes along.
 *
 * The automatic trigger is deliberately keyed on "the row has no account" (no
 * email and never activated), NOT on "the row was just created". A driver who was
 * stranded by an EARLIER sync already has their second row, which is never new
 * again; narrowing this back to "just created" would silently leave them broken
 * for ever. It stays idempotent: once a transfer lands the target has an email,
 * so later syncs skip it.
 */
class DriverAccountTransferService
{
    /**
     * How long the old company's roster may go without a sync before its drivers
     * count as abandoned. The old company's own sync is the only thing that ever
     * writes roster_removed_at, so a company that stopped syncing (subscription
     * expired, banned, dead for weeks) would otherwise strand its drivers for ever.
     *
     * 14 days is far beyond any transient outage observed: Uber session drops last
     * hours (the worst on record was 5h37m). The Uber session status is deliberately
     * NOT a signal here: a company whose session is briefly down is still a paying,
     * operating customer, and one bad night must never move drivers off a healthy fleet.
     */
    public const STALE_ROSTER_DAYS = 14;

    /** Why a manual transfer was refused; stable codes the admin API returns. */
    public const REFUSAL_SAME_ROW = 'same_row';

    public const REFUSAL_UUID_MISMATCH = 'uuid_mismatch';

    public const REFUSAL_SOURCE_HAS_NO_ACCOUNT = 'source_has_no_account';

    public const REFUSAL_TARGET_HAS_EMAIL = 'target_has_email';

    /** Columns that make up the account, copied verbatim (the password stays a hash). */
    private const ACCOUNT_COLUMNS = ['email', 'password', 'locale', 'invited_at', 'activated_at', 'last_login_at'];

    /** What the old row loses. Locale is NOT NULL (a preference, not a credential), so it keeps its value. */
    private const CLEARED_COLUMNS = ['email', 'password', 'invited_at', 'activated_at', 'last_login_at', 'invite_token'];

    public function __construct(private readonly AuditLogger $audit) {}

    /** @return bool whether an account was moved onto $new */
    public function transferTo(Driver $new): bool
    {
        return $this->transferMany(new Collection([$new])) > 0;
    }

    /**
     * Automatic path for a whole roster sync: every target without an account is
     * matched against other companies' rows in ONE query (no per-driver round trip).
     *
     * @param  Collection<int, Driver>  $drivers  rows the sync touched
     * @return int accounts moved
     */
    public function transferMany(Collection $drivers): int
    {
        $targets = $drivers->filter(fn (Driver $d) => $d->uber_driver_uuid !== null && blank($d->email) && $d->activated_at === null);
        if ($targets->isEmpty()) {
            return 0;
        }

        $byUuid = $this->candidatesByUuid($targets);
        $moved = 0;
        foreach ($targets as $target) {
            $moved += $this->transferOne($target, $byUuid->get($target->uber_driver_uuid, new Collection)) ? 1 : 0;
        }

        return $moved;
    }

    /**
     * Manual path (super-admin): same move, same invariants, but the human decides
     * whether the old company let go, so the abandonment test is skipped.
     *
     * @throws DriverTransferRefused with a REFUSAL_* code
     */
    public function transfer(Driver $old, Driver $new): void
    {
        $refusal = match (true) {
            $old->is($new) => self::REFUSAL_SAME_ROW,
            $old->uber_driver_uuid === null || $old->uber_driver_uuid !== $new->uber_driver_uuid => self::REFUSAL_UUID_MISMATCH,
            ! $this->hasAccount($old) => self::REFUSAL_SOURCE_HAS_NO_ACCOUNT,
            filled($new->email) => self::REFUSAL_TARGET_HAS_EMAIL,
            default => null,
        };
        if ($refusal !== null) {
            throw new DriverTransferRefused($refusal);
        }

        $this->move($old, $new, 'admin');
    }

    public function hasAccount(Driver $driver): bool
    {
        return filled($driver->email) && $driver->activated_at !== null;
    }

    /** The old company has genuinely let go: dropped, unusable, or its roster is long dead. */
    public function isAbandoned(Driver $old): bool
    {
        return $old->roster_removed_at !== null
            || ! ($old->tenant?->isUsable() ?? false)
            || ($old->roster_synced_at !== null && $old->roster_synced_at->lt(now()->subDays(self::STALE_ROSTER_DAYS)));
    }

    /** @param Collection<int, Driver> $others same-UUID rows of any tenant that hold an account */
    private function transferOne(Driver $new, Collection $others): bool
    {
        $candidates = $others
            ->filter(fn (Driver $old) => $old->tenant_id !== $new->tenant_id && $this->isAbandoned($old))
            ->values();

        if ($candidates->count() > 1) {
            // The owner confirmed a driver is with one company at a time, so this is a data fault.
            Log::error('driver.transfer_ambiguous', [
                'new_driver_id' => $new->id,
                'uber_driver_uuid' => $new->uber_driver_uuid,
                'candidate_driver_ids' => $candidates->pluck('id')->all(),
            ]);

            return false;
        }
        if ($candidates->isEmpty()) {
            return false;
        }

        try {
            $this->move($candidates->first(), $new, 'roster_sync');
        } catch (Throwable $e) {
            // One bad pair must not stop the rest of a roster sync.
            Log::warning('driver.transfer_failed', ['new_driver_id' => $new->id, 'error' => $e->getMessage()]);

            return false;
        }

        return true;
    }

    /** @return Collection<string, Collection<int, Driver>> account-holding rows keyed by UUID */
    private function candidatesByUuid(Collection $targets): Collection
    {
        return Driver::withoutGlobalScopes()
            ->with('tenant')
            ->whereIn('uber_driver_uuid', $targets->pluck('uber_driver_uuid')->unique()->values())
            ->whereNotIn('tenant_id', $targets->pluck('tenant_id')->unique()->values())
            ->whereNotNull('email')
            ->whereNotNull('activated_at')
            ->get()
            ->groupBy('uber_driver_uuid');
    }

    private function move(Driver $old, Driver $new, string $via): void
    {
        DB::transaction(function () use ($old, $new) {
            // Raw column copy: no model events, and the hashed password moves as-is.
            $account = Driver::withoutGlobalScopes()->whereKey($old->id)->first(self::ACCOUNT_COLUMNS)->getAttributes();

            // Clear the old row FIRST: email is globally unique, so setting it on the
            // new row while the old one still holds it would trip a 1062.
            Driver::withoutGlobalScopes()->whereKey($old->id)
                ->update(array_fill_keys(self::CLEARED_COLUMNS, null));
            Driver::withoutGlobalScopes()->whereKey($new->id)->update($account);

            DeviceToken::withoutGlobalScopes()->where('driver_id', $old->id)
                ->update(['driver_id' => $new->id, 'tenant_id' => $new->tenant_id]);

            DB::table('personal_access_tokens')
                ->where('tokenable_type', $old->getMorphClass())
                ->where('tokenable_id', $old->id)
                ->update(['tokenable_id' => $new->id]);
        });

        $new->refresh();

        // A cross-company data move must never be silent.
        $this->audit->log('driver.account_transferred', $new, [
            'from_driver_id' => $old->id,
            'to_driver_id' => $new->id,
            'from_tenant_id' => $old->tenant_id,
            'to_tenant_id' => $new->tenant_id,
            'uber_driver_uuid' => $new->uber_driver_uuid,
            'via' => $via,
        ], $new->tenant_id);
    }
}
