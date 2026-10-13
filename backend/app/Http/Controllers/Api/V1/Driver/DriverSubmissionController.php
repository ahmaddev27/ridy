<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Domain\Fleet\Models\Vehicle;
use App\Http\Controllers\Controller;
use App\Jobs\RingElProfessor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

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
    /** What the company's screen stores literally; `Other` is never one. */
    private const CATEGORIES = ['Tanken', 'Autowäsche', 'Autozubehör', 'Öl wechseln'];

    /**
     * The ten note types El-Professor stores, as an allow-list on purpose: a
     * type this build has not heard of (`krank`, a typo) must be refused, never
     * waved through as an ordinary note, which a deny-list would do.
     */
    private const NOTE_TYPES = [
        'general', 'other', 'blitzer', 'accident', 'kontrolle', 'breakdown', 'wait',
        'sick', 'vacation', 'off',
    ];

    /**
     * The types El-Professor plans around (`must_include_in_plan`). It refuses
     * these with `vehicle_required` when no plate comes with them; refusing here
     * first means the driver is told at once instead of the note travelling to
     * be refused there.
     */
    private const INCIDENT_NOTE_TYPES = ['blitzer', 'accident', 'kontrolle', 'breakdown', 'wait'];

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

    public function index(Request $request): JsonResponse
    {
        if (! $this->connected($request)) {
            return $this->notConnected();
        }

        $driver = $request->user();

        $rows = ElProfessorSubmission::query()
            ->withoutGlobalScopes()
            ->where('tenant_id', $driver->tenant_id)
            ->where('driver_id', $driver->id)
            ->orderByDesc('created_at')
            ->limit(50)
            ->get(['uuid', 'subject', 'status', 'decision_text', 'created_at']);

        return response()->json([
            'data' => $rows->map(fn (ElProfessorSubmission $r) => [
                'id' => $r->uuid,
                'subject' => $r->subject,
                'status' => $r->status,
                // The company's own words on a rejection. The driver has to see
                // them, or the rejection is something they cannot act on.
                'reason' => $r->decision_text,
                'created_at' => $r->created_at?->toIso8601String(),
            ])->values(),
        ]);
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

    public function store(Request $request): JsonResponse
    {
        if (! $this->connected($request)) {
            return $this->notConnected();
        }

        $driver = $request->user();
        $subject = (string) $request->input('subject', 'receipt');

        $rules = [
            'subject' => ['required', Rule::in(ElProfessorSubmission::SUBJECTS)],
        ];

        if ($subject === 'receipt') {
            $rules += [
                // The photo, when there is one. Older app builds still send it;
                // builds from 10.10.2026 read the receipt on the phone and send
                // the figures alone. Still capped below PHP's post_max_size,
                // above which the request arrives EMPTY with no message at all.
                'document' => [
                    'nullable', 'file', 'mimes:jpg,jpeg,png,pdf',
                    'max:'.config('elprofessor.max_document_kb', 8192),
                ],
                'receipt_date' => ['required', 'date_format:Y-m-d'],
                // One shape on the wire: a plain decimal with a dot, at most
                // two places. El-Professor's own parser reads `1.234` as 1.23
                // if it is handed German formatting, so no other shape travels.
                'amount' => ['required', 'regex:/^\d{1,8}(\.\d{1,2})?$/'],
                'category' => ['nullable', Rule::in(self::CATEGORIES)],
                'description' => ['nullable', 'string', 'max:500'],
                'payment_method' => ['nullable', Rule::in(['bar', 'uberweisung'])],
                'postal_code' => ['nullable', 'regex:/^\d{5}$/'],
                // What the Beleg itself says, beyond the amount. The company
                // reviews all of it on the other side; this validator's job is
                // to refuse what is obviously unusable, not to be the
                // authority - the same rule the rest of this method follows.
                'merchant_name' => ['nullable', 'string', 'max:200'],
                'city' => ['nullable', 'string', 'max:120'],
                'receipt_time' => ['nullable', 'date_format:H:i'],
                // Fuel only, and the app sends null on everything else. One
                // shape on the wire, as with the amount: a plain decimal with
                // a dot, two places for litres and three for the unit price.
                // El-Professor's parser reads `1.234` as 1.23 if it is handed
                // German formatting, and these figures reach an accountant.
                'litres' => ['nullable', 'regex:/^\d{1,8}(\.\d{1,2})?$/'],
                'price_per_litre' => ['nullable', 'regex:/^\d{1,8}(\.\d{1,3})?$/'],
                // The odometer, read on the phone from a photo of the cluster
                // that stays there. Four to seven digits: below that it is a
                // range or a trip meter, which is the exact confusion the
                // app's own rule exists to refuse.
                //
                // `string` BEFORE `integer` is load-bearing and not a style
                // choice. This payload travels to El-Professor VERBATIM
                // (`ElProfessorController::submission()` merges it as it is),
                // and El-Professor's parser takes a string or nothing - a bare
                // JSON number reaches it as a value its `text()` reader answers
                // null for, so a MANDATORY odometer would be dropped in
                // silence, with a 200 on both sides. `integer` alone admits
                // `25382` as well as `"25382"`, so one shape is pinned here.
                // With `integer` present Laravel still sizes `min`/`max`
                // numerically rather than by string length (`getSize()` checks
                // the numeric rules first) - pinned by a test, not assumed.
                'odometer_km' => ['nullable', 'string', 'integer', 'min:1000', 'max:9999999'],
                // Range left, the only fuel figure on that panel that is text.
                // Zero is a real reading: a car driven to empty shows it.
                'range_km' => ['nullable', 'string', 'integer', 'min:0', 'max:2000'],
            ];
        } else {
            $rules += [
                'note_type' => ['required', Rule::in(self::NOTE_TYPES)],
                'note_text' => ['required', 'string', 'max:2000'],
                // The plate as the fleet knows it, picked from `vehicles()`
                // and never typed. 32 is El-Professor's own bound. A blank
                // value reaches here as null (the framework trims and nulls
                // it), and the literal word `null` is refused there, so it is
                // refused here too rather than travelling to be refused.
                'vehicle_plate' => [
                    Rule::requiredIf(fn () => in_array($request->input('note_type'), self::INCIDENT_NOTE_TYPES, true)),
                    'nullable', 'string', 'max:32', 'regex:/^(?!\s*null\s*$)/i',
                ],
                'start_date' => ['nullable', 'date_format:Y-m-d'],
                'end_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:start_date'],
                'is_full_day' => ['nullable', 'boolean'],
                'start_time' => ['nullable', 'date_format:H:i'],
                'end_time' => ['nullable', 'date_format:H:i'],
            ];
        }

        $data = $request->validate($rules);

        // A receipt with neither a category nor a free description has no
        // subject at all, which El-Professor's own CHECK refuses; saying so here
        // means the driver reads it rather than a rejection days later.
        if ($subject === 'receipt'
            && ($data['category'] ?? null) === null
            && trim((string) ($data['description'] ?? '')) === '') {
            return response()->json([
                'message' => 'Either a category or a description is required.',
                'errors' => ['category' => ['Either a category or a description is required.']],
            ], 422);
        }

        $path = null;
        $mime = null;
        $bytes = null;
        $file = $subject === 'receipt' ? $request->file('document') : null;
        if ($file !== null) {
            // One folder per fleet, so a cleanup or an export is per tenant and
            // never has to parse a filename to know whose it is.
            $path = $file->store('elprofessor/'.$driver->tenant_id, config('elprofessor.disk', 'local'));
            $mime = $file->getMimeType();
            $bytes = $file->getSize();
        }

        // An absent plate is sent as an absent field, never as null.
        $payload = collect($data)
            ->except(['subject', 'document'])
            ->reject(fn ($value, $key) => $key === 'vehicle_plate' && $value === null)
            ->all();

        $row = ElProfessorSubmission::create([
            'tenant_id' => $driver->tenant_id,
            'driver_id' => $driver->id,
            'subject' => $subject,
            'status' => ElProfessorSubmission::STATUS_PENDING,
            'payload' => $payload,
            'document_path' => $path,
            'document_mime' => $mime,
            'document_bytes' => $bytes,
        ]);

        // The ring is best-effort by design: the submission is already stored
        // and visible to the company's catch-up, so a queue that is down delays
        // it rather than losing it.
        RingElProfessor::dispatch($row->id);

        return response()->json([
            'data' => [
                'id' => $row->uuid,
                'subject' => $row->subject,
                'status' => $row->status,
            ],
        ], 201);
    }
}
