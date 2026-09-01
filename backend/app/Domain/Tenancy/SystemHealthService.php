<?php

namespace App\Domain\Tenancy;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonInterface;

/**
 * Builds the super-admin "System Health" report: one row per tenant with the
 * live status of each critical subsystem (subscription, Uber session, dispatch
 * daemon, residential proxy). Rows are ordered most-problematic first so the
 * admin sees what needs action at the top.
 */
class SystemHealthService
{
    /** A heartbeat older than this means the stream/daemon is no longer live. */
    private const HEARTBEAT_TTL_MINUTES = 5;

    /** @return array<int, array<string, mixed>> */
    public function report(): array
    {
        $now = now();

        $tenants = Tenant::query()->with('proxy')->get();
        // Newest session per tenant — unique() keeps the first of the desc-sorted rows.
        $sessions = UberFleetSession::withoutGlobalScopes()
            ->orderByDesc('updated_at')
            ->get()
            ->unique('tenant_id')
            ->keyBy('tenant_id');

        return $tenants
            ->map(fn (Tenant $tenant) => $this->row($tenant, $sessions->get($tenant->id), $now))
            ->sortByDesc('_severity')
            ->values()
            ->map(function (array $row) {
                unset($row['_severity']);

                return $row;
            })
            ->all();
    }

    /** @return array<string, mixed> */
    private function row(Tenant $tenant, ?UberFleetSession $session, CarbonInterface $now): array
    {
        $subscription = $this->subscription($tenant);
        $sessionHealth = $this->session($session, $now);
        $daemon = $this->daemon($session, $now);
        $proxy = $this->proxy($tenant, $now);

        return [
            'id' => $tenant->id,
            'name' => $tenant->name,
            'subscription' => $subscription,
            'session' => $sessionHealth,
            'daemon' => $daemon,
            'proxy' => $proxy,
            // Higher = more problems; used only for ordering, then stripped.
            '_severity' => $this->severity($subscription, $sessionHealth, $daemon, $proxy),
        ];
    }

    /** @return array{state: string|null, days_left: int|null} */
    private function subscription(Tenant $tenant): array
    {
        return [
            'state' => $tenant->stateReason(),
            'days_left' => $tenant->daysLeft(),
        ];
    }

    /** @return array{status: string|null, last_seen: string|null, ok: bool} */
    private function session(?UberFleetSession $session, CarbonInterface $now): array
    {
        if ($session === null) {
            return ['status' => null, 'last_seen' => null, 'ok' => false];
        }

        return [
            'status' => $session->status,
            'last_seen' => $session->last_event_at?->toIso8601String(),
            'ok' => $session->status === UberFleetSession::STATUS_ACTIVE
                && $this->isFresh($session->last_event_at, $now),
        ];
    }

    /** @return array{ok: bool, last_heartbeat: string|null} */
    private function daemon(?UberFleetSession $session, CarbonInterface $now): array
    {
        $lastHeartbeat = $session?->last_event_at;

        return [
            'ok' => $this->isFresh($lastHeartbeat, $now),
            'last_heartbeat' => $lastHeartbeat?->toIso8601String(),
        ];
    }

    /** @return array{label: string|null, expires_at: string|null, ok: bool} */
    private function proxy(Tenant $tenant, CarbonInterface $now): array
    {
        $proxy = $tenant->proxy;

        if ($proxy === null) {
            return ['label' => null, 'expires_at' => null, 'ok' => false];
        }

        $notExpired = $proxy->expires_at === null || $proxy->expires_at->endOfDay()->greaterThanOrEqualTo($now);

        return [
            'label' => $proxy->label,
            'expires_at' => $proxy->expires_at?->toDateString(),
            'ok' => $notExpired,
        ];
    }

    private function isFresh(?CarbonInterface $timestamp, CarbonInterface $now): bool
    {
        if ($timestamp === null) {
            return false;
        }

        return $timestamp->greaterThanOrEqualTo($now->subMinutes(self::HEARTBEAT_TTL_MINUTES));
    }

    /**
     * @param  array{state: string|null, days_left: int|null}  $subscription
     * @param  array{status: string|null, last_seen: string|null, ok: bool}  $session
     * @param  array{ok: bool, last_heartbeat: string|null}  $daemon
     * @param  array{label: string|null, expires_at: string|null, ok: bool}  $proxy
     */
    private function severity(array $subscription, array $session, array $daemon, array $proxy): int
    {
        return ($subscription['state'] !== null ? 1 : 0)
            + ($session['ok'] ? 0 : 1)
            + ($daemon['ok'] ? 0 : 1)
            + ($proxy['ok'] ? 0 : 1);
    }
}
