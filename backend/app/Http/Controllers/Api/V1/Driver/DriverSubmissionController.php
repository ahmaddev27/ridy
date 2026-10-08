<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Http\Controllers\Controller;
use App\Jobs\RingElProfessor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
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
 * ## The photo is mandatory for a receipt
 *
 * A receipt with no photo cannot be accepted on the other side
 * (`document_missing`), so refusing it here is what lets the driver learn at the
 * moment they submit rather than days later from a rejection.
 */
class DriverSubmissionController extends Controller
{
    /** What the company's screen stores literally; `Other` is never one. */
    private const CATEGORIES = ['Tanken', 'Autowäsche', 'Autozubehör', 'Öl wechseln'];

    /** The ten note types El-Professor stores; the three absence types are
     *  refused at its own door and are not offered here either. */
    private const NOTE_TYPES = [
        'general', 'other', 'blitzer', 'accident', 'kontrolle', 'breakdown', 'wait',
    ];

    public function index(Request $request): JsonResponse
    {
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

    public function store(Request $request): JsonResponse
    {
        $driver = $request->user();
        $subject = (string) $request->input('subject', 'receipt');

        $rules = [
            'subject' => ['required', Rule::in(ElProfessorSubmission::SUBJECTS)],
        ];

        if ($subject === 'receipt') {
            $rules += [
                // The photo. Mandatory, and capped below PHP's post_max_size:
                // above it the request arrives EMPTY with no message at all.
                'document' => [
                    'required', 'file', 'mimes:jpg,jpeg,png,pdf',
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
            ];
        } else {
            $rules += [
                'note_type' => ['required', Rule::in(self::NOTE_TYPES)],
                'note_text' => ['required', 'string', 'max:2000'],
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
        if ($subject === 'receipt') {
            $file = $request->file('document');
            // One folder per fleet, so a cleanup or an export is per tenant and
            // never has to parse a filename to know whose it is.
            $path = $file->store('elprofessor/'.$driver->tenant_id, config('elprofessor.disk', 'local'));
            $mime = $file->getMimeType();
            $bytes = $file->getSize();
        }

        $payload = collect($data)
            ->except(['subject', 'document'])
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
