<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Billing\Money;
use App\Domain\Billing\SubscriptionCodeQuery;
use App\Domain\Collections\Models\CollectorPayment;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Concerns\ResolvesPerPage;
use App\Http\Controllers\Controller;
use App\Support\Csv;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Super-admin billing reports. Revenue is the cash companies actually paid
 * (collector_payments); the invoices list is the auto-generated subscription
 * periods. Both are read-only aggregates over existing data.
 */
class BillingReportController extends Controller
{
    use ResolvesPerPage;

    /** Revenue over time + subscriptions expiring soon + headline totals. */
    public function summary(Request $request): JsonResponse
    {
        $days = min(max($request->integer('expiring_days', 14), 1), 365);

        // Revenue = paid invoices, grouped by the month they were paid. Grouping
        // happens in PHP so the SQL stays portable across sqlite (local) and
        // MySQL (prod). Summed in integer cents so totals never float-drift.
        $byMonth = SubscriptionPeriod::query()
            ->whereNotNull('paid_at')
            ->get(['paid_at', 'amount'])
            ->groupBy(fn (SubscriptionPeriod $p) => $p->paid_at->format('Y-m'))
            ->map(fn ($group) => $group->sum(fn (SubscriptionPeriod $p) => Money::cents($p->amount)))
            ->sortKeys();

        $revenue = $byMonth->map(fn (int $cents, string $month) => ['month' => $month, 'total' => Money::toFloat($cents)])->values();

        // A canceled, never-paid invoice is no longer collectible.
        $outstanding = SubscriptionPeriod::query()
            ->whereNull('paid_at')
            ->whereNull('canceled_at')
            ->pluck('amount')
            ->sum(fn ($amount) => Money::cents($amount));

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
                    'total_revenue' => Money::toFloat((int) $byMonth->sum()),
                    'outstanding' => Money::toFloat((int) $outstanding),
                    'active_subscriptions' => Tenant::query()->usable()->count(),
                    'expiring_soon' => $expiring->count(),
                ],
            ],
        ]);
    }

    /** The auto-generated subscription invoices, newest first, optionally by company. */
    public function invoices(Request $request): JsonResponse
    {
        $invoices = $this->invoiceQuery($request)->paginate($this->perPage($request));

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
            // "Invoice" is the legal number (RE-YYYY-NNNN); the internal id trails.
            fputcsv($out, ['Invoice', 'Company', 'Days', 'Amount', 'Status', 'Starts', 'Ends', 'ID']);
            foreach ($rows as $p) {
                fputcsv($out, [
                    Csv::cell($p->invoiceNumber()),
                    Csv::cell($p->tenant?->name),
                    $p->days,
                    $p->amount !== null ? number_format((float) $p->amount, 2, '.', '') : '',
                    $p->isCanceled() ? 'canceled' : ($p->isPaid() ? 'paid' : 'unpaid'),
                    $p->starts_at->toDateString(),
                    $p->ends_at->toDateString(),
                    $p->id,
                ]);
            }
            fclose($out);
        }, 'subscription-invoices.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /** Every issued activation code with its lifecycle status, filtered + paged. */
    public function codes(Request $request, SubscriptionCodeQuery $query): JsonResponse
    {
        $codes = $query->forRequest($request)->paginate($this->perPage($request));

        return response()->json([
            'data' => collect($codes->items())->map(fn (SubscriptionCode $c) => $query->present($c)),
            'meta' => [
                'current_page' => $codes->currentPage(),
                'last_page' => $codes->lastPage(),
                'total' => $codes->total(),
            ],
        ]);
    }

    public function codesExport(Request $request, SubscriptionCodeQuery $query): StreamedResponse
    {
        $rows = $query->forRequest($request)->get();

        return response()->streamDownload(function () use ($rows) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM for Excel
            fputcsv($out, ['Code', 'Reference', 'Method', 'Plan', 'Company', 'Collector', 'Amount', 'Paid', 'Status', 'Created', 'Activated', 'Expires']);
            foreach ($rows as $c) {
                fputcsv($out, [
                    $c->code,
                    Csv::cell($c->payment_ref),
                    Csv::cell($c->payment_method),
                    Csv::cell($c->plan?->name),
                    Csv::cell($c->tenant?->name),
                    Csv::cell($c->collector?->name),
                    $c->amount !== null ? number_format((float) $c->amount, 2, '.', '') : '',
                    $c->paid ? 'yes' : 'no',
                    $c->status(),
                    $c->created_at?->toDateString(),
                    $c->activated_at?->toDateString() ?? '',
                    $c->expires_at?->toDateString(),
                ]);
            }
            fclose($out);
        }, 'subscription-codes.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /**
     * @return Builder<SubscriptionPeriod>
     */
    private function invoiceQuery(Request $request): Builder
    {
        return SubscriptionPeriod::query()
            ->with(['tenant:id,name', 'code.plan:id,name', 'code.collector:id,name'])
            ->when($request->filled('tenant_id'), fn (Builder $q) => $q->where('tenant_id', $request->integer('tenant_id')))
            ->orderByDesc('starts_at')
            ->orderByDesc('id');
    }

    /**
     * Settle an open invoice by linking the collector payment that covers it. One
     * payment can cover several invoices only up to its amount, and an invoice
     * that is already paid is only re-linked on an explicit `resettle`.
     */
    public function settle(Request $request, SubscriptionPeriod $invoice): JsonResponse
    {
        $data = $request->validate([
            'collector_payment_id' => ['required', 'integer', 'exists:collector_payments,id'],
            'resettle' => ['sometimes', 'boolean'],
        ]);

        return DB::transaction(function () use ($data, $invoice) {
            $invoice = SubscriptionPeriod::query()->lockForUpdate()->findOrFail($invoice->id);
            $payment = CollectorPayment::query()->lockForUpdate()->findOrFail($data['collector_payment_id']);

            if ((int) $payment->tenant_id !== (int) $invoice->tenant_id) {
                return response()->json(['message' => 'payment_company_mismatch'], 422);
            }
            if ($invoice->isPaid() && ! ($data['resettle'] ?? false)) {
                return response()->json(['message' => 'invoice_already_paid'], 409);
            }

            $allocated = SubscriptionPeriod::query()
                ->where('collector_payment_id', $payment->id)
                ->whereKeyNot($invoice->id)
                ->pluck('amount')
                ->sum(fn ($amount) => Money::cents($amount));
            $remaining = Money::cents($payment->amount) - $allocated;
            if (Money::cents($invoice->amount) > $remaining) {
                return response()->json([
                    'message' => 'payment_insufficient',
                    'remaining' => $remaining / 100,
                ], 422);
            }

            // paid_at only — the printed issue date never moves on settlement.
            $invoice->forceFill([
                'collector_payment_id' => $payment->id,
                'paid_at' => $payment->paid_on,
            ])->save();

            return response()->json(['data' => $this->present($invoice->fresh())]);
        });
    }

    /** @return array<string, mixed> */
    private function present(SubscriptionPeriod $p): array
    {
        $code = $p->code;

        return [
            'id' => $p->id,
            'invoice_no' => $p->invoiceNumber(),
            'canceled' => $p->isCanceled(),
            'tenant_id' => $p->tenant_id,
            'company_name' => $p->tenant?->name,
            'days' => $p->days,
            'amount' => $p->amount !== null ? (float) $p->amount : null,
            'paid' => $p->isPaid(),
            'paid_at' => $p->paid_at?->toDateString(),
            'collector_payment_id' => $p->collector_payment_id,
            'starts_at' => $p->starts_at->toDateString(),
            'ends_at' => $p->ends_at->toDateString(),
            // The activation code that produced this invoice + its plan, so the
            // Subscriptions table can show a code badge + plan and open a detail modal.
            'plan' => $code?->plan?->name,
            'code' => $code ? [
                'id' => $code->id,
                'code' => $code->code,
                'payment_ref' => $code->payment_ref,
                'payment_method' => $code->payment_method,
                'plan' => $code->plan?->name,
                'collector' => $code->collector?->name,
                'amount' => $code->amount !== null ? (float) $code->amount : null,
                'paid' => (bool) $code->paid,
                'status' => $code->status(),
                'created_at' => $code->created_at?->toIso8601String(),
                'activated_at' => $code->activated_at?->toDateString(),
                'expires_at' => $code->expires_at?->toIso8601String(),
            ] : null,
        ];
    }
}
