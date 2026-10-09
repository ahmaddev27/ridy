<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Domain\Notifications\AppNotification;
use App\Domain\Notifications\SubmissionDecisionNotifier;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Notifications\DatabaseNotification;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

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

        $params = [
            'external_submission_id' => $submissionId,
            'kind' => $data['kind'] ?? 'note',
            'reason_code' => $data['reason_code'],
            'reason_text' => $data['reason_text'] ?? null,
        ];

        $driver->notify(new AppNotification(self::REJECTED_TYPE, $params));

        // The bell row above reaches nobody on its own: `AppNotification::via()`
        // is `['database']` and the driver's app has no endpoint that reads
        // those rows. So the telling is a push, on its own channel, and it never
        // fails this request -- the decision is already recorded, and a
        // transport that is down must not have El-Professor retry it.
        app(SubmissionDecisionNotifier::class)->rejected($driver, $params);

        // Since 08.10.2026 this side keeps the submissions, so the decision
        // lands on the row as well as in the driver's notifications — which is
        // what lets the driver's own list show WHY, rather than only a bell
        // entry they may have dismissed.
        //
        // It is an update and not a requirement: a submission id this side does
        // not know is still notified, because the notification is the point and
        // the id belonged to El-Professor before this table existed. The tenant
        // is a term in the query for the same reason as above.
        ElProfessorSubmission::query()
            ->withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('uuid', $submissionId)
            ->update([
                'status' => ElProfessorSubmission::STATUS_REJECTED,
                'decided_at' => now(),
                'decision_code' => $data['reason_code'],
                'decision_text' => $data['reason_text'] ?? null,
                'updated_at' => now(),
            ]);

        $this->recordUsage($tenantId);

        return response()->json(['data' => ['notified' => true, 'duplicate' => false]]);
    }

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
     * Same rule as `submissionStatus()`: a submission of another fleet and one
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
            if ($last === null || $now->diffInMinutes(Carbon::parse($last), true) >= self::LAST_USED_INTERVAL_MINUTES) {
                $changes['last_used_at'] = $now->toIso8601String();
            }

            if ($changes !== []) {
                $tenant->mergeElprofessorState($changes);
            }
        });
    }
}
