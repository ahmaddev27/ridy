<?php

namespace App\Domain\Collections;

use App\Domain\Collections\Models\CollectorPayment;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

/**
 * Builds the filtered payment query shared by the list and the CSV export, so
 * both always apply the same collector/company/date filters.
 */
class CollectorPaymentQuery
{
    /**
     * @return Builder<CollectorPayment>
     */
    public function forRequest(Request $request): Builder
    {
        return CollectorPayment::query()
            ->with(['collector:id,name', 'tenant:id,name'])
            ->when($request->filled('collector_id'), fn (Builder $q) => $q->where('collector_id', $request->integer('collector_id')))
            ->when($request->filled('tenant_id'), fn (Builder $q) => $q->where('tenant_id', $request->integer('tenant_id')))
            ->when($request->filled('from'), fn (Builder $q) => $q->whereDate('paid_on', '>=', $request->date('from')))
            ->when($request->filled('to'), fn (Builder $q) => $q->whereDate('paid_on', '<=', $request->date('to')))
            ->orderByDesc('paid_on')
            ->orderByDesc('id');
    }
}
