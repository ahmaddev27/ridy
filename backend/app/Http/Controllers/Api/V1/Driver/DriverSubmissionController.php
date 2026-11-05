<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Domain\Fleet\Models\Vehicle;
use App\Domain\Fleet\SubmissionDetailPresenter;
use App\Domain\Fleet\SubmissionRecorder;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * What a driver submits to their own company: a receipt with its photo, or a
 * note. Stored here and fetched by El-Professor (see `RingElProfessor` for why
 * it is a fetch and not a push).
 *
 * ## The driver and the fleet are never taken from the request
 *
 * Both come off the authenticated driver. The same rule the rest of this group
 * follows — "a driver's tenant is derived from the driver, not the request" —
 * and here it is what stops one driver filing a receipt in another's name.
 *
 * ## Every field is a CLAIM, and the company reviews it
 *
 * Nothing here enters anybody's books. El-Professor records the submission as
 * pending and a person there accepts or rejects it; its parser validates every
 * field again, because a `bar` receipt changes what the driver owes the company
 * and a `Tanken` one changes their fuel ratio. So this validator's job is to
 * refuse what is obviously unusable — no photo, an amount that is not a number,
 * a date that is not a date — and not to be the authority.
 *
 * ## Sending needs the connection; reading does not
 *
 * `index` and `show` stay open when the company disconnects: what
 * a driver already sent is his own history (owner's decision, 25.10.2026).
 * `store` and `vehicles` (the note form's picker) still need it, so a
 * disconnected company can never be sent to.
 *
 * ## A driver whose company is not connected cannot submit at all
 *
 * `documents_enabled` on the driver's profile is
 * `Tenant::isElprofessorConnected()`: a live `elprofessor` token, not revoked,
 * **and El-Professor has actually used it at least once**. Until all three hold
 * there is nobody to fetch a submission, so one stored here would sit in a
 * table no one reads while the driver believes it was sent.
 *
 * The app hides the section on the same flag, and that is the message; **this
 * is the wall**. A stale screen, a deep link or a company that revoked its
 * token after the app last loaded all reach here, and all are refused with a
 * stable reason the app can render.
 *
 * ## The photo is OPTIONAL, and new apps do not send one
 *
 * It was mandatory until 10.10.2026, when the owner decided a driver sends the
 * figures and not the document: the app photographs the receipt, reads it with
 * the phone's own OCR, and keeps the image on the device.
 *
 * It stays accepted rather than refused, because **an app already installed on
 * a driver's phone still sends one**. There is no store update that reaches
 * every device at once, so a rule that refused a photo would break every
 * submission from an older build; and a rule that required one would break
 * every submission from a newer one. Optional is the only shape that serves
 * both, and it is not temporary scaffolding - it is what a fleet of phones on
 * different versions actually needs.
 *
 * What is lost with it is the only way to check a figure afterwards. The app
 * replaces that at the point of entry: a field its rules were unsure about is
 * flagged and cannot be sent until the driver confirms it by hand.
 */
class DriverSubmissionController extends Controller
{
    /**
     * Whether this driver's company is connected to El-Professor, which is the
     * only condition under which a submission reaches anybody.
     */
    private function connected(Request $request): bool
    {
        return $request->user()?->tenant?->isElprofessorConnected() ?? false;
    }

    private function notConnected(): JsonResponse
    {
        // A stable code, not a sentence: the app renders it in the driver's own
        // language, as it does with every other refusal.
        return response()->json([
            'message' => 'This company is not connected to El-Professor.',
            'reason' => 'not_connected',
        ], 403);
    }

    public function index(Request $request, SubmissionDetailPresenter $presenter): JsonResponse
    {
        $driver = $request->user();

        $rows = ElProfessorSubmission::query()
            ->withoutGlobalScopes()
            ->where('tenant_id', $driver->tenant_id)
            ->where('driver_id', $driver->id)
            ->orderByDesc('created_at')
            ->limit(50)
            ->get(['uuid', 'subject', 'status', 'decision_text', 'payload', 'created_at']);

        return response()->json([
            'data' => $rows->map(fn (ElProfessorSubmission $r) => $presenter->row($r))->values(),
        ]);
    }

    /**
     * One of this driver's own submissions, in full.
     *
     * The driver is a TERM IN THE QUERY, not a check after it: another driver's
     * submission and one that does not exist are the same missing row, so the
     * 404 is identical by construction and says nothing about which uuids
     * exist. Same shape as `ElProfessorController::submission()`.
     */
    public function show(Request $request, SubmissionDetailPresenter $presenter, string $uuid): JsonResponse
    {
        $row = $this->ownSubmission($request, $uuid);

        return $row === null
            ? response()->json(['message' => 'Submission not found.'], 404)
            : response()->json(['data' => $presenter->present($row)]);
    }

    private function ownSubmission(Request $request, string $uuid): ?ElProfessorSubmission
    {
        $driver = $request->user();

        return ElProfessorSubmission::query()
            ->withoutGlobalScopes()
            ->where('tenant_id', $driver->tenant_id)
            ->where('driver_id', $driver->id)
            ->where('uuid', $uuid)
            ->first();
    }

    /**
     * The fleet's plates, for the note form's picker. The tenant is a term in
     * the query, so another fleet's vehicle is not a refusal after the fact but
     * a row that is never selected. Only what a picker needs.
     */
    public function vehicles(Request $request): JsonResponse
    {
        if (! $this->connected($request)) {
            return $this->notConnected();
        }

        $rows = Vehicle::query()
            ->withoutGlobalScopes()
            ->where('tenant_id', $request->user()->tenant_id)
            ->whereNotNull('license_plate')
            ->where('license_plate', '!=', '')
            ->orderBy('license_plate')
            ->get(['id', 'license_plate', 'make', 'model']);

        return response()->json([
            'data' => $rows->map(fn (Vehicle $v) => [
                'id' => $v->id,
                'license_plate' => $v->license_plate,
                'make' => $v->make,
                'model' => $v->model,
            ])->values(),
        ]);
    }

    public function store(Request $request, SubmissionRecorder $recorder): JsonResponse
    {
        if (! $this->connected($request)) {
            return $this->notConnected();
        }

        [$subject, $data] = $recorder->validate($request);
        $row = $recorder->record($request->user(), $subject, $data, $request);

        return response()->json([
            'data' => [
                'id' => $row->uuid,
                'subject' => $row->subject,
                'status' => $row->status,
            ],
        ], 201);
    }
}
