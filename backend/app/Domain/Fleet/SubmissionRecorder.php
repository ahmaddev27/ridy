<?php

namespace App\Domain\Fleet;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Jobs\RingElProfessor;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Validates and stores one Beleg or note filed IN A DRIVER'S NAME.
 *
 * Shared by the driver's own endpoint and the manager's on-behalf one, so the
 * wire rules, the El-Professor ring exist exactly once.
 * The caller decides WHO the driver is (token for a driver; a tenant-checked
 * pick for a manager) and whether the company is connected; this class only
 * ever receives an already-authorised {@see Driver}.
 */
class SubmissionRecorder
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
     * @return array{0: string, 1: array<string, mixed>} the subject and the validated fields
     *
     * @throws ValidationException
     */
    public function validate(Request $request): array
    {
        $subject = (string) $request->input('subject', 'receipt');

        $rules = [
            'subject' => ['required', Rule::in(ElProfessorSubmission::SUBJECTS)],
        ];

        if ($subject === 'receipt') {
            $rules += [
                // Accepted from older builds, validated and DROPPED (never
                // stored). Capped below PHP's post_max_size, above which the
                // request arrives EMPTY with no message at all.
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
                // The Beleg's header split into what it actually prints. Older
                // apps send `merchant_name` alone, so all of these are optional.
                'station_name' => ['nullable', 'string', 'max:120'],
                'operator_name' => ['nullable', 'string', 'max:120'],
                // The branch number a chain prints after the station word
                // ("JET TANKSTELLE 318") - its own datum, apart from the name.
                'station_number' => ['nullable', 'string', 'max:16'],
                'street' => ['nullable', 'string', 'max:200'],
                // The number printed on the receipt itself (beside `Bon` on a
                // JET one), never an id of ours.
                'receipt_number' => ['nullable', 'string', 'max:32'],
                // The German fiscal (TSE) timestamp's time of day. It is NOT
                // the sale time, which stays `receipt_time`, so it travels apart.
                'tse_time' => ['nullable', 'date_format:H:i:s'],
                // Audit only: stored in their own columns below, kept out of
                // the payload that El-Professor fetches and the driver reads.
                'ocr_text' => ['nullable', 'string', 'max:8000'],
                'ocr_meta' => ['nullable', 'array'],
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
            throw ValidationException::withMessages([
                'category' => ['Either a category or a description is required.'],
            ]);
        }

        return [$subject, $data];
    }

    /** @param  array<string, mixed>  $data  as returned by {@see validate()} */
    public function record(Driver $driver, string $subject, array $data, Request $request): ElProfessorSubmission
    {
        // An absent plate is sent as an absent field, never as null.
        $payload = collect($data)
            ->except(['subject', 'document', 'ocr_text', 'ocr_meta', 'driver_id'])
            ->reject(fn ($value, $key) => $key === 'vehicle_plate' && $value === null)
            ->all();

        $row = ElProfessorSubmission::create([
            'tenant_id' => $driver->tenant_id,
            'driver_id' => $driver->id,
            'subject' => $subject,
            'status' => ElProfessorSubmission::STATUS_PENDING,
            'payload' => $payload,
            'ocr_text' => $data['ocr_text'] ?? null,
            'ocr_meta' => $data['ocr_meta'] ?? null,
        ]);

        // The ring is best-effort by design: the submission is already stored
        // and visible to the company's catch-up, so a queue that is down delays
        // it rather than losing it.
        RingElProfessor::dispatch($row->id);

        return $row;
    }
}
