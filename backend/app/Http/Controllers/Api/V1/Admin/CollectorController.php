<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Collections\Models\Collector;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super-admin management of cash collectors. The list carries each collector's
 * derived totals (how much they've collected) — the "total per collector" report.
 */
class CollectorController extends Controller
{
    public function index(): JsonResponse
    {
        $collectors = Collector::query()
            ->withCount('payments')
            ->withSum('payments as total_collected', 'amount')
            ->withMax('payments as last_paid_on', 'paid_on')
            ->orderBy('name')
            ->get()
            ->map(fn (Collector $c) => $this->present($c));

        return response()->json(['data' => $collectors]);
    }

    public function store(Request $request): JsonResponse
    {
        $collector = Collector::create($this->validated($request));

        return response()->json(['data' => $this->present($collector)], 201);
    }

    public function update(Request $request, Collector $collector): JsonResponse
    {
        $collector->update($this->validated($request));

        return response()->json(['data' => $this->present($collector->fresh())]);
    }

    public function destroy(Collector $collector): JsonResponse
    {
        // Deleting would cascade the whole payment ledger — block it so financial
        // history is never lost by accident. The admin must clear payments first.
        if ($collector->payments()->exists()) {
            return response()->json(['message' => 'collector_has_payments'], 422);
        }

        $collector->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:50'],
            'address' => ['nullable', 'string', 'max:500'],
        ]);
    }

    /** @return array<string, mixed> */
    private function present(Collector $c): array
    {
        return [
            'id' => $c->id,
            'name' => $c->name,
            'phone' => $c->phone,
            'address' => $c->address,
            'payments_count' => (int) ($c->payments_count ?? 0),
            'total_collected' => (float) ($c->total_collected ?? 0),
            // withMax returns a raw date string (no model cast applies to it).
            'last_paid_on' => $c->getAttribute('last_paid_on'),
        ];
    }
}
