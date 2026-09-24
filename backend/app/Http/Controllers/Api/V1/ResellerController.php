<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Billing\ActivationCodeIssuer;
use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\SubscriptionCodeQuery;
use App\Domain\Collections\Models\Collector;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Concerns\ResolvesPerPage;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Reseller surface: a collector with a login issues activation codes for a
 * company against a fixed plan. Price and duration come from the plan, never
 * free-typed, and the resulting invoice is tagged with the reseller who sold it.
 */
class ResellerController extends Controller
{
    use ResolvesPerPage;

    /** The reseller's own issued codes (with lifecycle status), filtered + paged. */
    public function codes(Request $request, SubscriptionCodeQuery $query): JsonResponse
    {
        abort_unless($request->user()->can('codes.generate'), 403);

        $collector = Collector::where('user_id', $request->user()->id)->first();
        if ($collector === null) {
            return response()->json(['data' => [], 'meta' => ['current_page' => 1, 'last_page' => 1, 'total' => 0]]);
        }

        // Force the reseller's own collector — they never see other resellers' codes.
        $request->merge(['collector_id' => $collector->id]);
        $codes = $query->forRequest($request)->paginate($this->perPage($request, 20));

        return response()->json([
            'data' => collect($codes->items())->map(fn ($c) => $query->present($c)),
            'meta' => ['current_page' => $codes->currentPage(), 'last_page' => $codes->lastPage(), 'total' => $codes->total()],
        ]);
    }

    /** The active plans a reseller may sell. */
    public function plans(): JsonResponse
    {
        $plans = Plan::where('active', true)->orderBy('price')->get()
            ->map(fn (Plan $p) => ['id' => $p->id, 'name' => $p->name, 'price' => (float) $p->price, 'duration_days' => $p->duration_days]);

        return response()->json(['data' => $plans]);
    }

    /** Minimum digits before a query is also matched against owner phones. */
    private const PHONE_SEARCH_MIN_DIGITS = 6;

    /**
     * Search companies by name (min 2 chars) or owner phone (min 6 digits). LIKE
     * wildcards in the query are literal, and the owner phone is masked unless the
     * reseller searched by that phone or already sells to the company (DSGVO data
     * minimisation — a reseller is an external partner).
     */
    public function searchCompanies(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        if (mb_strlen($q) < 2) {
            return response()->json(['data' => []]);
        }

        $like = '%'.addcslashes($q, '%_\\').'%';
        $nameIds = Tenant::query()->where('name', 'like', $like)->limit(20)->pluck('id');
        $phoneIds = strlen((string) preg_replace('/\D/', '', $q)) >= self::PHONE_SEARCH_MIN_DIGITS
            ? User::query()->where('phone', 'like', $like)->whereNotNull('tenant_id')
                ->distinct()->limit(20)->pluck('tenant_id')
            : collect();
        $ids = $nameIds->merge($phoneIds)->unique()->take(15);

        // One query for all owner phones (was one per company).
        $phones = User::query()->whereIn('tenant_id', $ids)->whereNotNull('phone')
            ->orderBy('id')->get(['tenant_id', 'phone'])
            ->unique('tenant_id')->pluck('phone', 'tenant_id');
        $collectorId = Collector::where('user_id', $request->user()->id)->value('id');

        $companies = Tenant::query()->whereIn('id', $ids)->orderBy('name')
            ->get(['id', 'name', 'activation_collector_id'])
            ->map(function (Tenant $t) use ($phones, $phoneIds, $collectorId) {
                $phone = $phones->get($t->id);
                $reveal = $phoneIds->contains($t->id)
                    || ($collectorId !== null && $t->activation_collector_id === $collectorId);

                return [
                    'id' => $t->id,
                    'name' => $t->name,
                    'phone' => $phone === null || $reveal ? $phone : $this->maskPhone($phone),
                ];
            });

        return response()->json(['data' => $companies]);
    }

    /** "+49 151 2345678" → "+49•••••678": enough to recognise, not to call. */
    private function maskPhone(string $phone): string
    {
        $length = mb_strlen($phone);
        if ($length <= 6) {
            return str_repeat('•', $length);
        }

        return mb_substr($phone, 0, 3).str_repeat('•', $length - 6).mb_substr($phone, -3);
    }

    /** Issue an activation code for a company on a plan. */
    public function generate(Request $request, ActivationCodeIssuer $issuer): JsonResponse
    {
        abort_unless($request->user()->can('codes.generate'), 403);

        $collector = Collector::where('user_id', $request->user()->id)->first();
        if ($collector === null) {
            throw ValidationException::withMessages(['collector' => 'not_a_reseller']);
        }

        $data = $request->validate([
            'tenant_id' => ['required', 'integer', 'exists:tenants,id'],
            'plan_id' => ['required', 'integer'],
        ]);

        $plan = Plan::where('active', true)->find($data['plan_id']);
        if ($plan === null) {
            throw ValidationException::withMessages(['plan_id' => 'plan_unavailable']);
        }

        $tenant = Tenant::findOrFail($data['tenant_id']);
        if ($tenant->banned_at !== null) {
            throw ValidationException::withMessages(['tenant_id' => 'company_banned']);
        }

        // The fleet pays the reseller in person, up front — so a reseller-issued
        // code is always paid, in cash. The issuer refuses (under a tenant lock) to
        // clobber a still-valid code minted by a DIFFERENT issuer.
        $issued = $issuer->issue($tenant, $plan, true, 'cash', $collector->id, $request->user()->id, protectForeignPending: true);

        return response()->json(['data' => [
            'code' => $issued['code'],
            'payment_ref' => $issued['payment_ref'],
            'payment_method' => 'cash',
            'company' => $tenant->name,
            'plan' => $plan->name,
            'days' => $plan->duration_days,
            'price' => (float) $plan->price,
            'expires_at' => $issued['expires_at']->toIso8601String(),
        ]]);
    }
}
