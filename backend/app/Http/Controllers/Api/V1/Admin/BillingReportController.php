<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Collections\Models\CollectorPayment;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Super-admin billing reports. Revenue is the cash companies actually paid
 * (collector_payments); the invoices list is the auto-generated subscription
 * periods. Both are read-only aggregates over existing data.
 */
class BillingReportController extends Controller
{
    /** Revenue over time + subscriptions expiring soon + headline totals. */
    public function summary(Request $request): JsonResponse
    {
        $days = min(max($request->integer('expiring_days', 14), 1), 365);

        // Group payments by calendar month in PHP so the SQL stays portable
        // across sqlite (local) and MySQL (prod).
        $byMonth = CollectorPayment::query()
            ->get(['paid_on', 'amount'])
            ->groupBy(fn (CollectorPayment $p) => $p->paid_on->format('Y-m'))
            ->map(fn ($group) => (float) $group->sum('amount'))
            ->sortKeys();

        $revenue = $byMonth->map(fn (float $total, string $month) => ['month' => $month, 'total' => $total])->values();

        $expiring = Tenant::query()
            ->usable()
            ->whereNotNull('subscription_ends_at')
            ->whereBetween('subscription_ends_at', [CarbonImmutable::now(), CarbonImmutable::now()->addDays($days)])
            ->orderBy('subscription_ends_at')
            ->get()
            ->map(fn (Tenant $t) => [
                'id' => $t->id,
                'name' => $t->name,
                'ends_at' => $t->subscription_ends_at?->toDateString(),
                'days_left' => $t->daysLeft(),
            ]);

        return response()->json([
            'data' => [
                'revenue_by_month' => $revenue,
                'expiring' => $expiring,
                'totals' => [
                    'total_revenue' => (float) CollectorPayment::sum('amount'),
                    'active_subscriptions' => Tenant::query()->usable()->count(),
                    'expiring_soon' => $expiring->count(),
                ],
            ],
        ]);
    }

    /** The auto-generated subscription invoices, newest first, optionally by company. */
    public function invoices(Request $request): JsonResponse
    {
        $invoices = $this->invoiceQuery($request)->paginate(min($request->integer('per_page', 25), 100));

        return response()->json([
            'data' => collect($invoices->items())->map(fn (SubscriptionPeriod $p) => $this->present($p)),
            'meta' => [
                'current_page' => $invoices->currentPage(),
                'last_page' => $invoices->lastPage(),
                'total' => $invoices->total(),
            ],
        ]);
    }

    public function invoicesExport(Request $request): StreamedResponse
    {
        $rows = $this->invoiceQuery($request)->get();

        return response()->streamDownload(function () use ($rows) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM for Excel
            fputcsv($out, ['Invoice', 'Company', 'Days', 'Starts', 'Ends']);
            foreach ($rows as $p) {
                fputcsv($out, [$p->id, $p->tenant?->name, $p->days, $p->starts_at->toDateString(), $p->ends_at->toDateString()]);
            }
            fclose($out);
        }, 'subscription-invoices.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /**
     * @return Builder<SubscriptionPeriod>
     */
    private function invoiceQuery(Request $request): Builder
    {
        return SubscriptionPeriod::query()
            ->with('tenant:id,name')
            ->when($request->filled('tenant_id'), fn (Builder $q) => $q->where('tenant_id', $request->integer('tenant_id')))
            ->orderByDesc('starts_at')
            ->orderByDesc('id');
    }

    /** @return array<string, mixed> */
    private function present(SubscriptionPeriod $p): array
    {
        return [
            'id' => $p->id,
            'tenant_id' => $p->tenant_id,
            'company_name' => $p->tenant?->name,
            'days' => $p->days,
            'starts_at' => $p->starts_at->toDateString(),
            'ends_at' => $p->ends_at->toDateString(),
        ];
    }
}
