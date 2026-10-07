<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\AppNotification;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Notifications\DatabaseNotification;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The link to El-Professor, a separate payroll product. It PULLS: the operator
 * mints a token here and pastes it into El-Professor, which then reads the
 * roster.
 *
 * ONE thing travels the other way, and it is a decision rather than a drift:
 * when a company REJECTS something its driver submitted, El-Professor tells us
 * so with `submissionStatus()` and we notify that driver. An acceptance sends
 * nothing — the owner's decision of 06.10.2026: a rejection is news the driver
 * must act on, an acceptance is not worth a push.
 *
 * The token holds only `elprofessor:read`, which EnsureDashboardToken confines
 * to the exact routes listed there. That now includes one POST, which is the
 * tradeoff written down: the ability is named `read` and admits one write. It
 * is bounded to "mark one of this tenant's submissions decided" by an exact
 * path rather than a wildcard, and a second ability would have meant a second
 * mint-and-revoke flow in the dashboard for one endpoint. A wildcard here would
 * be the real mistake: an ability missing from that map is not confined at all.
 */
class ElProfessorController extends Controller
{
    private const MAX_PER_PAGE = 100;

    private const LAST_USED_INTERVAL_MINUTES = 60;

    /** The semantic type the driver app renders in the driver's own language. */
    public const REJECTED_TYPE = 'elprofessor.submission_rejected';

    /**
     * El-Professor tells us a company rejected what one of our drivers sent.
     *
     * ## It carries OUR driver id, not a submission of ours
     *
     * The submission id belongs to El-Professor; this side has no table of
     * submissions and does not need one. What makes the notification
     * addressable is `external_driver_id` — the `drivers.id` we issued and they
     * stored — resolved inside the token's own tenant, exactly as the roster is.
     * A driver of another tenant is a 404 and the same 404 as a driver that does
     * not exist, so a caller learns nothing about other fleets.
     *
     * ## Only `rejected` is accepted
     *
     * Nothing else is sent today, and silently accepting a status we do not act
     * on is the kind of thing that reads as working. If acceptances are ever to
     * be shown, the driver app has to render them, which is a release on this
     * side either way.
     *
     * ## The reason is DATA, not a rendered sentence
     *
     * `AppNotification` already says this in its own header: a stable semantic
     * `type` plus structured `params`, never pre-rendered text, "so the frontend
     * renders the title/body/icon in each user's own language". So the type is
     * `elprofessor.submission_rejected` and the reviewer's own words ride in
     * `params.reason_text`. The driver app shows a translated heading above the
     * reason verbatim — which is the only way a German reviewer's sentence makes
     * sense to a driver reading the app in Arabic.
     *
     * ## A retry does not notify twice
     *
     * El-Professor may resend after a lost response. The submission id is
     * compared against the driver's existing notifications of this type, so the
     * second call answers `notified: false` and writes nothing. The comparison
     * is done in PHP rather than with a JSON path, because `notifications.data`
     * is a `text` column and a JSON operator over it is not portable.
     */
    public function submissionStatus(Request $request): JsonResponse
    {
        $tenantId = (int) $request->user()->tenant_id;

        $data = $request->validate([
            'external_submission_id' => ['required', 'string', 'max:255'],
            'external_driver_id' => ['required', 'integer'],
            'status' => ['required', 'string', 'in:rejected'],
            'reason_code' => ['required', 'string', 'max:64'],
            'reason_text' => ['nullable', 'string', 'max:2000'],
            'kind' => ['nullable', 'string', 'in:note,receipt'],
        ]);

        // One lookup, one 404, one message. The tenant is a term in the query
        // rather than a check after it, so a foreign fleet's driver and a driver
        // nobody has are the same answer BY CONSTRUCTION. A second branch here —
        // the kind someone adds to be helpful — is an enumeration oracle, and
        // test_a_driver_of_another_tenant_is_the_same_404... catches it: measured
        // by adding exactly that branch and watching it fail on the byte
        // comparison.
        $driver = Driver::query()
            ->where('tenant_id', $tenantId)
            ->whereKey((int) $data['external_driver_id'])
            ->first();
        if ($driver === null) {
            return response()->json(['message' => 'Driver not found.'], 404);
        }

        $submissionId = $data['external_submission_id'];
        $already = DatabaseNotification::query()
            ->where('notifiable_type', $driver->getMorphClass())
            ->where('notifiable_id', $driver->getKey())
            ->where('type', AppNotification::class)
            ->latest()
            ->limit(200)
            ->get()
            ->contains(function (DatabaseNotification $row) use ($submissionId) {
                $params = $row->data['params'] ?? [];

                return ($row->data['type'] ?? null) === self::REJECTED_TYPE
                    && ($params['external_submission_id'] ?? null) === $submissionId;
            });

        if ($already) {
            return response()->json(['data' => ['notified' => false, 'duplicate' => true]]);
        }

        $driver->notify(new AppNotification(
            self::REJECTED_TYPE,
            [
                'external_submission_id' => $submissionId,
                'kind' => $data['kind'] ?? 'note',
                'reason_code' => $data['reason_code'],
                'reason_text' => $data['reason_text'] ?? null,
            ],
        ));

        $this->recordUsage($tenantId);

        return response()->json(['data' => ['notified' => true, 'duplicate' => false]]);
    }

    public function issueToken(Request $request): JsonResponse
    {
        $user = $request->user();
        $tenant = Tenant::query()->findOrFail($user->tenant_id);

        // One link per company: replace every earlier token, whoever minted it.
        $tenant->elprofessorTokens()->delete();
        $token = $user->createToken('elprofessor', ['elprofessor:read'])->plainTextToken;

        $tenant->mergeElprofessorState([
            'token_issued_at' => now()->toIso8601String(),
            'revoked_at' => null,
            'first_used_at' => null,
            'last_used_at' => null,
        ]);

        return response()->json(['data' => [
            'token' => $token,
            'tenant_id' => $tenant->id,
            'tenant_name' => $tenant->name,
            'payment_reference' => $tenant->ensurePaymentReference(),
        ]]);
    }

    public function revokeToken(Request $request): JsonResponse
    {
        $tenant = Tenant::query()->findOrFail($request->user()->tenant_id);

        $tenant->elprofessorTokens()->delete();
        $tenant->mergeElprofessorState(['revoked_at' => now()->toIso8601String()]);

        return response()->json(['data' => $tenant->fresh()->elprofessorConnection()]);
    }

    /** Never returns the token itself. */
    public function connection(Request $request): JsonResponse
    {
        $tenant = Tenant::query()->findOrFail($request->user()->tenant_id);

        return response()->json(['data' => $tenant->elprofessorConnection()]);
    }

    /**
     * Who this token belongs to. The only identity a confined token can read,
     * so El-Professor can check it matches the fleet the operator named.
     * Deliberately three fields: no settings, counts or connection timestamps.
     */
    public function fleet(Request $request): JsonResponse
    {
        $tenant = Tenant::query()->findOrFail($request->user()->tenant_id);

        $this->recordUsage($tenant->id);

        return response()->json(['data' => [
            'tenant_id' => $tenant->id,
            'tenant_name' => $tenant->name,
            'payment_reference' => $tenant->ensurePaymentReference(),
        ]]);
    }

    public function drivers(Request $request): JsonResponse
    {
        $tenantId = (int) $request->user()->tenant_id;
        $perPage = max(1, min(self::MAX_PER_PAGE, (int) $request->query('per_page', 50)));

        $page = Driver::query()
            ->where('tenant_id', $tenantId)
            ->orderBy('id')
            ->select(['id', 'name', 'email', 'phone', 'employment_type', 'uber_driver_uuid', 'activated_at', 'roster_removed_at'])
            ->paginate($perPage);

        $this->recordUsage($tenantId);

        return response()->json([
            'data' => $page->getCollection()->map(fn (Driver $d) => [
                'id' => $d->id,
                'name' => $d->name,
                'email' => $d->email,
                'phone' => $d->phone,
                'employment_type' => $d->employment_type,
                'uber_driver_uuid' => $d->uber_driver_uuid,
                'activated_at' => $d->activated_at?->toIso8601String(),
                'roster_removed_at' => $d->roster_removed_at?->toIso8601String(),
            ])->values(),
            'meta' => [
                'page' => $page->currentPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
                'tenant_id' => $tenantId,
            ],
        ]);
    }

    /**
     * first_used_at is set once; last_used_at at most once an hour, so a pull
     * does not write on every request. Locked so two pulls cannot clobber the
     * other settings keys.
     */
    private function recordUsage(int $tenantId): void
    {
        DB::transaction(function () use ($tenantId) {
            $tenant = Tenant::query()->lockForUpdate()->findOrFail($tenantId);
            $state = $tenant->settings['elprofessor'] ?? [];
            $now = now();
            $changes = [];

            if (empty($state['first_used_at'])) {
                $changes['first_used_at'] = $now->toIso8601String();
            }
            $last = $state['last_used_at'] ?? null;
            if ($last === null || $now->diffInMinutes(\Illuminate\Support\Carbon::parse($last), true) >= self::LAST_USED_INTERVAL_MINUTES) {
                $changes['last_used_at'] = $now->toIso8601String();
            }

            if ($changes !== []) {
                $tenant->mergeElprofessorState($changes);
            }
        });
    }
}
