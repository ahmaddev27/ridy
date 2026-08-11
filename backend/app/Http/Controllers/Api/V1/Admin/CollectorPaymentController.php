<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Collections\CollectorPaymentQuery;
use App\Domain\Collections\Models\CollectorPayment;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Super-admin cash-payment ledger. Records who (which fleet) paid which collector
 * and serves the filtered list (per-company statement) plus a CSV export.
 */
class CollectorPaymentController extends Controller
{
    public function __construct(private readonly CollectorPaymentQuery $query) {}

    public function index(Request $request): JsonResponse
    {
        $payments = $this->query->forRequest($request)->paginate(min($request->integer('per_page', 25), 100));

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
            'amount' => ['required', 'numeric', 'gt:0', 'max:99999999'],
            'paid_on' => ['required', 'date'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        $data['created_by'] = $request->user()->id;

        $payment = CollectorPayment::create($data)->load(['collector:id,name', 'tenant:id,name']);

        return response()->json(['data' => $this->present($payment)], 201);
    }

    public function destroy(CollectorPayment $payment): JsonResponse
    {
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
                    $p->tenant?->name,
                    $p->collector?->name,
                    number_format((float) $p->amount, 2, '.', ''),
                    $p->note,
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
