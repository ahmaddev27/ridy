<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Collections\CollectorPaymentQuery;
use App\Domain\Collections\Models\CollectorPayment;
use App\Http\Controllers\Concerns\ResolvesPerPage;
use App\Http\Controllers\Controller;
use App\Support\Csv;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Super-admin cash-payment ledger. Records who (which fleet) paid which collector
 * and serves the filtered list (per-company statement) plus a CSV export.
 */
class CollectorPaymentController extends Controller
{
    use ResolvesPerPage;

    public function __construct(private readonly CollectorPaymentQuery $query) {}

    public function index(Request $request): JsonResponse
    {
        $payments = $this->query->forRequest($request)->paginate($this->perPage($request));

        return response()->json([
            'data' => collect($payments->items())->map(fn (CollectorPayment $p) => $this->present($p)),
            'meta' => [
                'current_page' => $payments->currentPage(),
                'last_page' => $payments->lastPage(),
                'total' => $payments->total(),
                // Sum across the whole filtered set (not just this page) for the footer.
                'sum' => (float) $this->query->forRequest($request)->sum('amount'),
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'collector_id' => ['required', 'integer', 'exists:collectors,id'],
            'tenant_id' => ['required', 'integer', 'exists:tenants,id'],
            // decimal(12,2): at most 2 decimals, no silent rounding.
            'amount' => ['required', 'numeric', 'decimal:0,2', 'gt:0', 'max:9999999999.99'],
            'paid_on' => ['required', 'date', 'after_or_equal:2020-01-01', 'before_or_equal:today'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        $data['created_by'] = $request->user()->id;

        // A double-click / network retry must not book the same cash twice: an
        // identical row from the same admin within the last minute is returned.
        $duplicate = CollectorPayment::query()
            ->where('collector_id', $data['collector_id'])
            ->where('tenant_id', $data['tenant_id'])
            ->where('amount', $data['amount'])
            ->whereDate('paid_on', $data['paid_on'])
            ->where('created_by', $data['created_by'])
            ->where('created_at', '>=', now()->subMinute())
            ->first();
        if ($duplicate !== null) {
            return response()->json(['data' => $this->present($duplicate->load(['collector:id,name', 'tenant:id,name']))]);
        }

        $payment = CollectorPayment::create($data)->load(['collector:id,name', 'tenant:id,name']);

        return response()->json(['data' => $this->present($payment)], 201);
    }

    /**
     * Delete a mistaken ledger row. A payment that already settled an invoice is
     * refused: deleting it would leave that invoice "paid" with no payment behind
     * it and make revenue and the cash ledger disagree.
     */
    public function destroy(CollectorPayment $payment): JsonResponse
    {
        $settled = SubscriptionPeriod::where('collector_payment_id', $payment->id)->pluck('id');
        if ($settled->isNotEmpty()) {
            return response()->json(['message' => 'payment_settles_invoices', 'invoice_ids' => $settled], 409);
        }

        $payment->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    /** Stream the filtered ledger as UTF-8 CSV (opens directly in Excel). */
    public function export(Request $request): StreamedResponse
    {
        $rows = $this->query->forRequest($request)->get();

        return response()->streamDownload(function () use ($rows) {
            $out = fopen('php://output', 'w');
            // BOM so Excel reads UTF-8 (Arabic company/collector names) correctly.
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, ['Date', 'Company', 'Collector', 'Amount', 'Note']);
            foreach ($rows as $p) {
                fputcsv($out, [
                    $p->paid_on->toDateString(),
                    Csv::cell($p->tenant?->name),
                    Csv::cell($p->collector?->name),
                    number_format((float) $p->amount, 2, '.', ''),
                    Csv::cell($p->note),
                ]);
            }
            fclose($out);
        }, 'collector-payments.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /** @return array<string, mixed> */
    private function present(CollectorPayment $p): array
    {
        return [
            'id' => $p->id,
            'collector_id' => $p->collector_id,
            'collector_name' => $p->collector?->name,
            'tenant_id' => $p->tenant_id,
            'company_name' => $p->tenant?->name,
            'amount' => (float) $p->amount,
            'paid_on' => $p->paid_on->toDateString(),
            'note' => $p->note,
        ];
    }
}
