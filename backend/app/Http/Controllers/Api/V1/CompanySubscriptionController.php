<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A company's own subscription history — the periods it activated, each with the
 * code that produced it, the plan, the collector who sold it, and its status.
 * Tenant-scoped: a manager only ever sees their own company's records.
 */
class CompanySubscriptionController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $tenantId = (int) $request->user()->tenant_id;

        $periods = SubscriptionPeriod::where('tenant_id', $tenantId)
            ->with(['code.plan:id,name', 'code.collector:id,name'])
            ->orderByDesc('starts_at')
            ->orderByDesc('id')
            ->get()
            ->map(function (SubscriptionPeriod $p) {
                $code = $p->code;

                return [
                    'id' => $p->id,
                    'plan' => $code?->plan?->name,
                    'code' => $code?->code,
                    'code_status' => $code?->status(),
                    'collector' => $code?->collector?->name,
                    'amount' => $p->amount !== null ? (float) $p->amount : null,
                    'paid' => $p->isPaid(),
                    'days' => $p->days,
                    'starts_at' => $p->starts_at->toDateString(),
                    'ends_at' => $p->ends_at->toDateString(),
                ];
            });

        return response()->json(['data' => $periods]);
    }
}
