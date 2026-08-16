<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Billing\Models\Plan;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * Public catalogue of active subscription plans, used by the marketing site's
 * pricing section. Only the safe, customer-facing fields are exposed (never the
 * admin-only flags), and inactive plans are hidden.
 */
class PublicPlanController extends Controller
{
    public function index(): JsonResponse
    {
        $plans = Plan::query()
            ->where('active', true)
            ->orderBy('price')
            ->get(['id', 'name', 'price', 'duration_days']);

        return response()->json([
            'data' => $plans->map(fn (Plan $plan) => [
                'id' => $plan->id,
                'name' => $plan->name,
                'price' => (float) $plan->price,
                'duration_days' => $plan->duration_days,
            ]),
        ]);
    }
}
