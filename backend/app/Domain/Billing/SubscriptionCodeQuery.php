<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Models\SubscriptionCode;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

/**
 * Shared filtering + presentation for issued activation codes, so the admin
 * ledger and a reseller's own list apply identical rules.
 */
class SubscriptionCodeQuery
{
    /**
     * @return Builder<SubscriptionCode>
     */
    public function forRequest(Request $request): Builder
    {
        $now = CarbonImmutable::now();

        return SubscriptionCode::query()
            ->with(['plan:id,name', 'tenant:id,name', 'collector:id,name'])
            ->when($request->filled('collector_id'), fn (Builder $q) => $q->where('collector_id', $request->integer('collector_id')))
            ->when($request->filled('tenant_id'), fn (Builder $q) => $q->where('tenant_id', $request->integer('tenant_id')))
            ->when($request->filled('from'), fn (Builder $q) => $q->whereDate('created_at', '>=', $request->date('from')))
            ->when($request->filled('to'), fn (Builder $q) => $q->whereDate('created_at', '<=', $request->date('to')))
            ->when($request->query('status') === 'activated', fn (Builder $q) => $q->whereNotNull('activated_at'))
            ->when($request->query('status') === 'pending', fn (Builder $q) => $q->whereNull('activated_at')->where('expires_at', '>', $now))
            ->when($request->query('status') === 'expired', fn (Builder $q) => $q->whereNull('activated_at')->where('expires_at', '<=', $now))
            ->orderByDesc('id');
    }

    /** @return array<string, mixed> */
    public function present(SubscriptionCode $c): array
    {
        return [
            'id' => $c->id,
            'code' => $c->code,
            'plan' => $c->plan?->name,
            'company' => $c->tenant?->name,
            'collector' => $c->collector?->name,
            'amount' => $c->amount !== null ? (float) $c->amount : null,
            'paid' => $c->paid,
            'status' => $c->status(),
            'created_at' => $c->created_at?->toIso8601String(),
            'activated_at' => $c->activated_at?->toDateString(),
            'expires_at' => $c->expires_at?->toIso8601String(),
        ];
    }
}
