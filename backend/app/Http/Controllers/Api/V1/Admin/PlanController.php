<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Super-admin management of subscription plans that resellers sell. */
class PlanController extends Controller
{
    public function index(): JsonResponse
    {
        $plans = Plan::orderByDesc('active')->orderBy('price')->get()->map(fn (Plan $p) => $this->present($p));

        return response()->json(['data' => $plans]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $data['active'] = $data['active'] ?? true;
        $plan = Plan::create($data);

        return response()->json(['data' => $this->present($plan)], 201);
    }

    public function update(Request $request, Plan $plan): JsonResponse
    {
        $plan->update($this->validated($request));

        return response()->json(['data' => $this->present($plan->fresh())]);
    }

    /**
     * A plan that was ever sold is ARCHIVED (deactivated), not deleted: the FK
     * nulls plan_id on delete, which blanked the plan name on every historical
     * code and invoice. Only a never-used plan is removed for real.
     */
    public function destroy(Plan $plan): JsonResponse
    {
        $used = SubscriptionCode::withoutGlobalScopes()->where('plan_id', $plan->id)->exists();

        if ($used) {
            $plan->forceFill(['active' => false])->save();

            return response()->json(['data' => ['deleted' => false, 'archived' => true]]);
        }

        $plan->delete();

        return response()->json(['data' => ['deleted' => true, 'archived' => false]]);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'price' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'duration_days' => ['required', 'integer', 'min:1', 'max:3650'],
            'active' => ['boolean'],
        ]);
    }

    /** @return array<string, mixed> */
    private function present(Plan $p): array
    {
        return [
            'id' => $p->id,
            'name' => $p->name,
            'price' => (float) $p->price,
            'duration_days' => $p->duration_days,
            'active' => $p->active,
        ];
    }
}
