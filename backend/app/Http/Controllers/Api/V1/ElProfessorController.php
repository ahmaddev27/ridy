<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Fleet\Earnings\EarningsReport;
use App\Domain\Fleet\Earnings\UberEarningsException;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Domain\Fleet\Models\Vehicle;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * The link to El-Professor, a separate payroll product. It PULLS: the operator
 * mints a token here and pastes it into El-Professor, which then reads the
 * roster.
 *
 * Nothing travels the other way. There used to be a route on which El-Professor
 * reported a rejected submission and we notified the driver; the owner removed
 * the review step on 13.10.2026, so no one rejects anything and the route, its
 * push and its ability entry were deleted.
 *
 * ## Submissions are FETCHED from here, and the reason is a measurement
 *
 * A driver's note or receipt used to be described as a push to El-Professor's
 * intake. That intake authenticates with the token this side issued — and
 * **Sanctum stores only a hash, so this side cannot replay it.** The owner
 * turned the direction around on 08.10.2026: this side RINGS (four fields, no
 * payload, no credential) and El-Professor fetches the submission with the token
 * it holds sealed. `submissions()` and `submission()` are that fetch, and
 * `RingElProfessor` is the ring.
 *
 * **Without the ring configured, nothing is lost**: El-Professor's operator has
 * a button that asks `submissions()` what is waiting. The ring only makes it
 * immediate, which is why this side needs no outbound credential of its own.
 *
 * The token holds only `elprofessor:read`, which EnsureDashboardToken confines
 * to the exact routes listed there -- all GETs. Written out rather than as a
 * wildcard: an ability missing from that map is not confined at all, and a
 * wildcard would hand the token every route a later release adds.
 */
class ElProfessorController extends Controller
{
    private const MAX_PER_PAGE = 100;

    /**
     * The longest business month is 5 Uber weeks = 35 days (a month owns the
     * weeks whose Monday falls in it); 38 leaves room for a partial piece at
     * either end. El-Professor calls this route once per week, so what the cap
     * really bounds is the outbound calls to Uber: at most 6 at 38.
     */
    private const MAX_EARNINGS_DAYS = 38;

    private const LAST_USED_INTERVAL_MINUTES = 60;

    /**
     * What is waiting for El-Professor to fetch, oldest first.
     *
     * Oldest first because the oldest is the one somebody has been waiting on;
     * `fleet/drivers` pages by id for a different reason (a stable roster
     * order) and the two must not be made to match.
     *
     * The list carries **no payload and no photo**: it is a list of what to
     * fetch, so a catch-up that reads a hundred waiting submissions does not
     * move a hundred photos to decide which to ask for. `subject` is in it
     * because El-Professor must know which of its two tables a submission
     * belongs to before it fetches one.
     */
    public function submissions(Request $request): JsonResponse
    {
        $tenantId = (int) $request->user()->tenant_id;
        $perPage = max(1, min(self::MAX_PER_PAGE, (int) $request->query('per_page', 50)));
        $status = (string) $request->query('status', ElProfessorSubmission::STATUS_PENDING);

        // An allow-list: `status` reaches a WHERE, and the only status worth
        // asking for from the other side is what is still waiting.
        if (! in_array($status, [
            ElProfessorSubmission::STATUS_PENDING,
            ElProfessorSubmission::STATUS_TAKEN,
        ], true)) {
            return response()->json(['message' => 'Unknown status.'], 422);
        }

        $rows = ElProfessorSubmission::query()
            ->withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('status', $status)
            ->orderBy('created_at')
            ->orderBy('id')
            ->limit($perPage)
            ->get(['uuid', 'subject', 'status', 'created_at', 'document_bytes']);

        $this->recordUsage($tenantId);

        return response()->json([
            'data' => $rows->map(fn (ElProfessorSubmission $r) => [
                'id' => $r->uuid,
                'subject' => $r->subject,
                'status' => $r->status,
                'created_at' => $r->created_at?->toIso8601String(),
                'document_bytes' => $r->document_bytes,
            ])->values(),
            'meta' => ['per_page' => $perPage, 'tenant_id' => $tenantId],
        ]);
    }

    /**
     * One submission, with its photo, for El-Professor to record.
     *
     * ## The tenant is a term in the query, not a check after it
     *
     * A submission of another fleet and one
     * that does not exist are the same 404 **by construction**, so a caller
     * holding one fleet's token learns nothing about another's.
     *
     * ## The photo travels as base64 inside the JSON
     *
     * The owner chose this on 08.10.2026 over a URL, and the reason is the one
     * that governs the whole integration: a URL in a payload is a destination
     * the other side would fetch, and these two products share a Docker network
     * with both their databases. Base64 costs a third more bytes and needs no
     * trust.
     *
     * ## Fetching marks it, and that is what stops a second ingestion
     *
     * `fetched_at` and `status = 'taken'` are written here, so the same
     * submission is not offered to the next catch-up. El-Professor is idempotent
     * on this id as well — two walls, because this one is only as good as the
     * request completing.
     */
    public function submission(Request $request, string $uuid): JsonResponse
    {
        $tenantId = (int) $request->user()->tenant_id;

        $row = ElProfessorSubmission::query()
            ->withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('uuid', $uuid)
            ->first();

        if ($row === null) {
            return response()->json(['message' => 'Submission not found.'], 404);
        }

        $document = null;
        if ($row->document_path !== null) {
            $disk = Storage::disk(config('elprofessor.disk', 'local'));
            // A path that is in the row but not on the disk is a real state —
            // a failed write, a cleaned volume — and it must not read as "this
            // receipt has no photo", which is what an empty string would do on
            // the other side. The field is absent instead, and El-Professor
            // refuses the submission with `document_missing`.
            if ($disk->exists($row->document_path)) {
                $document = base64_encode($disk->get($row->document_path));
            }
        }

        $row->forceFill([
            'status' => $row->status === ElProfessorSubmission::STATUS_PENDING
                ? ElProfessorSubmission::STATUS_TAKEN
                : $row->status,
            'fetched_at' => $row->fetched_at ?? now(),
        ])->save();

        $this->recordUsage($tenantId);

        // The payload verbatim, plus the ids and the photo. El-Professor
        // validates every field again: its `receipts` row moves money, so what
        // this side calls an amount is a claim until its parser agrees.
        return response()->json([
            'data' => array_merge((array) $row->payload, [
                'kind' => $row->subject,
                'subject' => $row->subject,
                'partner' => 'reidey',
                'external_submission_id' => $row->uuid,
                'external_driver_id' => (string) $row->driver_id,
                ...($document !== null ? ['document' => $document] : []),
                ...($row->document_mime !== null ? ['content_type' => $row->document_mime] : []),
            ]),
        ]);
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

    /**
     * The company's own El-Professor settings: whether a driver may attach a
     * receipt from the gallery rather than only from the camera, and whether the
     * receipt flow asks for the odometer. Each key is optional and independent.
     *
     * It is a setting of the COMPANY, not of the platform: the platform's
     * switch decides whether this company has the integration at all, and this
     * one decides how its own drivers may use it. Same capability as issuing
     * the token (`connections.manage`), because both are decisions about what
     * this company's drivers can send.
     */
    public function updateSettings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'gallery_import' => ['sometimes', 'boolean'],
            'odometer_required' => ['sometimes', 'boolean'],
        ]);

        $tenant = Tenant::query()->findOrFail($request->user()->tenant_id);
        if (array_key_exists('gallery_import', $data)) {
            $tenant->setElprofessorGalleryImport((bool) $data['gallery_import']);
        }
        if (array_key_exists('odometer_required', $data)) {
            $tenant->setElprofessorOdometerRequired((bool) $data['odometer_required']);
        }

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

    /**
     * What each driver earned on Uber in a range, pulled live from Fleet Hub with
     * the company's own stored session (El-Professor cannot make that request
     * itself). Money is text, never a JSON number: see EarnerFigures::money().
     *
     * The tenant is the token's, and the session, proxy and drivers are all
     * looked up by it, so there is no id in the request that could name another.
     */
    public function earnings(Request $request, EarningsReport $report): JsonResponse
    {
        $data = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $from = CarbonImmutable::createFromFormat('!Y-m-d', $data['from']);
        $to = CarbonImmutable::createFromFormat('!Y-m-d', $data['to']);
        if ($from->diffInDays($to) + 1 > self::MAX_EARNINGS_DAYS) {
            $max = self::MAX_EARNINGS_DAYS;

            return response()->json([
                'message' => "The range may cover at most {$max} days.",
                'reason' => "range_exceeds_{$max}_days",
                'max_days' => $max,
            ], 422);
        }

        $tenant = Tenant::query()->findOrFail($request->user()->tenant_id);

        try {
            $result = $report->forTenant($tenant, $from, $to);
        } catch (UberEarningsException $e) {
            return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], $e->status);
        } catch (\UnexpectedValueException) {
            return response()->json(['message' => 'Uber returned a figure that could not be read.', 'reason' => 'unreadable_amount'], 502);
        }

        $this->recordUsage($tenant->id);

        return response()->json([
            'data' => [
                'from' => $result['from'],
                'to' => $result['to'],
                'currency' => $result['currency'],
                'drivers' => $result['drivers'],
            ],
            'meta' => [
                'driver_count' => count($result['drivers']),
                'unmatched_count' => $result['unmatched'],
                // Uber drivers with no linked ridy driver, named so El-Professor can
                // say whom to link. Capped; the count above is always the full one.
                'unmatched' => $result['unmatched_list'],
                'unmatched_truncated' => $result['unmatched'] > count($result['unmatched_list']),
            ],
        ]);
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
     * The company's vehicles, for El-Professor's onboarding import.
     *
     * Reidey's `vehicles` table is filled ONLY when the browser extension syncs
     * (VehicleController::ingest). A company that never ran the extension has
     * zero vehicles, so an empty list here is a real state, not a failure.
     *
     * A vehicle with no plate is returned as it is (`license_plate: null`);
     * El-Professor decides what to do with it. Reduced on purpose to four fields
     * (id, Uber UUID, plate, assigned driver): El-Professor stores only the plate,
     * and this is one company's data crossing to another product.
     */
    public function vehicles(Request $request): JsonResponse
    {
        $tenantId = (int) $request->user()->tenant_id;
        $perPage = max(1, min(self::MAX_PER_PAGE, (int) $request->query('per_page', 50)));

        $page = Vehicle::query()
            ->where('tenant_id', $tenantId)
            ->orderBy('id')
            ->select(['id', 'uber_vehicle_uuid', 'license_plate', 'assigned_driver_uuid'])
            ->paginate($perPage);

        $this->recordUsage($tenantId);

        return response()->json([
            'data' => $page->getCollection()->map(fn (Vehicle $v) => [
                'id' => $v->id,
                'uber_vehicle_uuid' => $v->uber_vehicle_uuid,
                'license_plate' => $v->license_plate,
                'assigned_driver_uuid' => $v->assigned_driver_uuid,
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
            if ($last === null || $now->diffInMinutes(Carbon::parse($last), true) >= self::LAST_USED_INTERVAL_MINUTES) {
                $changes['last_used_at'] = $now->toIso8601String();
            }

            if ($changes !== []) {
                $tenant->mergeElprofessorState($changes);
            }
        });
    }
}
