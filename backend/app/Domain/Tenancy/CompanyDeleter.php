<?php

namespace App\Domain\Tenancy;

use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Collections\Models\CollectorPayment;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;

/**
 * Permanently deletes a company and everything scoped to it. Refused (by the
 * caller, via {@see hasBillingRecords()}) once the company has issued invoices or
 * cash payments — those are accounting records with a 10-year retention duty, so
 * such a company is disabled (and its operational data purged) instead.
 *
 * Order matters and every step is idempotent, so a failure part-way is safe to
 * re-run: the Uber session + push tokens go first (the daemon stream stops on the
 * next reconcile), the high-volume tables are deleted in bounded batches (no huge
 * undo log / long locks on the hot offers table while live ingest runs), then the
 * remaining rows and the tenant go in one short transaction.
 */
class CompanyDeleter
{
    private const BATCH = 2000;

    /** Whether the company has invoices or ledger payments that must be kept. */
    public function hasBillingRecords(Tenant $tenant): bool
    {
        return SubscriptionPeriod::where('tenant_id', $tenant->id)->exists()
            || CollectorPayment::where('tenant_id', $tenant->id)->exists();
    }

    public function delete(Tenant $tenant): void
    {
        $tenantId = $tenant->id;

        DB::table('uber_fleet_sessions')->where('tenant_id', $tenantId)->delete();
        DB::table('device_tokens')->where('tenant_id', $tenantId)->delete();

        $this->deleteInBatches('dispatch_offers', $tenantId);
        $this->deleteInBatches('dispatch_network_logs', $tenantId);

        DB::transaction(function () use ($tenant, $tenantId) {
            $userIds = DB::table('users')->where('tenant_id', $tenantId)->pluck('id');
            $driverIds = DB::table('drivers')->where('tenant_id', $tenantId)->pluck('id');

            // Polymorphic rows with no tenant_id: notifications, API tokens, roles.
            if ($userIds->isNotEmpty()) {
                DB::table('notifications')
                    ->where('notifiable_type', User::class)
                    ->whereIn('notifiable_id', $userIds)->delete();
                DB::table('personal_access_tokens')
                    ->where('tokenable_type', User::class)
                    ->whereIn('tokenable_id', $userIds)->delete();
                foreach (['model_has_roles', 'model_has_permissions'] as $key) {
                    DB::table(config("permission.table_names.{$key}", $key))
                        ->where('model_type', User::class)
                        ->whereIn(config('permission.column_names.model_morph_key', 'model_id'), $userIds)
                        ->delete();
                }
            }
            if ($driverIds->isNotEmpty()) {
                DB::table('personal_access_tokens')
                    ->where('tokenable_type', Driver::class)
                    ->whereIn('tokenable_id', $driverIds)->delete();
            }

            foreach (['drivers', 'audit_logs', 'users'] as $table) {
                DB::table($table)->where('tenant_id', $tenantId)->delete();
            }

            $tenant->delete();
        });

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    /** Delete a tenant's rows by primary key in bounded batches (portable: MySQL + SQLite). */
    private function deleteInBatches(string $table, int $tenantId): void
    {
        do {
            $ids = DB::table($table)->where('tenant_id', $tenantId)->limit(self::BATCH)->pluck('id');
            if ($ids->isNotEmpty()) {
                DB::table($table)->whereIn('id', $ids)->delete();
            }
        } while ($ids->count() === self::BATCH);
    }
}
