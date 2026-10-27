<?php

namespace App\Domain\Fleet;

use App\Domain\Fleet\Models\ElProfessorSubmission;
use Illuminate\Support\Facades\Storage;

/**
 * The full detail of one submission, as the driver who sent it sees it (and,
 * read-only, as the fleet owner does).
 *
 * ## A whitelist, field by field
 *
 * The payload is driver-supplied and travels to El-Professor verbatim, so what
 * it holds is whatever the validator let through today plus whatever a future
 * build adds. Returning it raw would turn every later field, and any key an
 * older build stored, into part of this response by being there. Each key below
 * is named on purpose; a key not named does not come back.
 *
 * Every key is always present and null when unknown, so a row from an older
 * build cannot break the app's reader.
 */
class SubmissionDetailPresenter
{
    /** Response key => payload key. */
    private const RECEIPT_FIELDS = [
        'receipt_date' => 'receipt_date',
        'receipt_time' => 'receipt_time',
        'amount' => 'amount',
        'category' => 'category',
        'merchant_name' => 'merchant_name',
        'station_name' => 'station_name',
        'operator_name' => 'operator_name',
        'street' => 'street',
        'city' => 'city',
        // The receipt's own printed number, and the fiscal (TSE) time of day,
        // which is not the sale time shown as `receipt_time`.
        'receipt_number' => 'receipt_number',
        'tse_time' => 'tse_time',
        // Stored as `postal_code` (the validator's name), shown as `plz`.
        'plz' => 'postal_code',
        'litres' => 'litres',
        'price_per_litre' => 'price_per_litre',
        'odometer_km' => 'odometer_km',
        'range_km' => 'range_km',
        'payment_method' => 'payment_method',
        'description' => 'description',
    ];

    private const NOTE_FIELDS = [
        'note_type' => 'note_type',
        'note_text' => 'note_text',
        'vehicle_plate' => 'vehicle_plate',
        'start_date' => 'start_date',
        'end_date' => 'end_date',
        'start_time' => 'start_time',
        'end_time' => 'end_time',
    ];

    /**
     * One row of a list: enough figures to tell two submissions apart, not the
     * payload. A whitelist on purpose, so a field added to the payload later
     * does not reach a list by being there. Every key is always present.
     *
     * @return array<string, mixed>
     */
    public function row(ElProfessorSubmission $r): array
    {
        return [
            'id' => $r->uuid,
            'subject' => $r->subject,
            'status' => $r->status,
            // The company's own words on a rejection.
            'reason' => $r->decision_text,
            'detail' => $this->summary($r),
            'created_at' => $r->created_at?->toIso8601String(),
        ];
    }

    /** @return array<string, string|null> */
    private function summary(ElProfessorSubmission $r): array
    {
        $p = is_array($r->payload) ? $r->payload : [];
        $text = fn (string $key): ?string => isset($p[$key]) && is_scalar($p[$key]) && trim((string) $p[$key]) !== ''
            ? trim((string) $p[$key])
            : null;

        if ($r->subject === 'receipt') {
            return [
                'amount' => $text('amount'),
                'category' => $text('category'),
                'merchant_name' => $text('merchant_name'),
            ];
        }

        return [
            'note_type' => $text('note_type'),
            'note_text' => $text('note_text'),
            'vehicle_plate' => $text('vehicle_plate'),
        ];
    }

    /** @return array<string, mixed> */
    public function present(ElProfessorSubmission $row): array
    {
        $isReceipt = $row->subject === 'receipt';
        $payload = is_array($row->payload) ? $row->payload : [];
        $fields = $this->fields($payload, $isReceipt ? self::RECEIPT_FIELDS : self::NOTE_FIELDS);

        if (! $isReceipt) {
            $fields['is_full_day'] = isset($payload['is_full_day'])
                ? filter_var($payload['is_full_day'], FILTER_VALIDATE_BOOLEAN)
                : null;
        }

        return [
            'id' => $row->uuid,
            'subject' => $row->subject,
            'status' => $row->status,
            'decided_at' => $row->decided_at?->toIso8601String(),
            // The company's own words on a rejection.
            'reason' => $row->decision_text,
            'created_at' => $row->created_at?->toIso8601String(),
            'fields' => $fields,
            'document' => $isReceipt ? $this->document($row) : null,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  array<string, string>  $map
     * @return array<string, string|bool|null>
     */
    private function fields(array $payload, array $map): array
    {
        $out = [];
        foreach ($map as $outKey => $payloadKey) {
            $value = $payload[$payloadKey] ?? null;
            $out[$outKey] = is_scalar($value) && trim((string) $value) !== '' ? trim((string) $value) : null;
        }

        return $out;
    }

    /**
     * Whether the photo can actually be served. A path in the row with nothing
     * on the disk is a real state (failed write, cleaned volume) and must read
     * as "no photo", never as a photo the app then fails to load.
     *
     * @return array{available: bool, mime: string|null, bytes: int|null}
     */
    private function document(ElProfessorSubmission $row): array
    {
        $available = $row->document_path !== null
            && Storage::disk(config('elprofessor.disk', 'local'))->exists($row->document_path);

        return [
            'available' => $available,
            'mime' => $available ? $row->document_mime : null,
            'bytes' => $available ? $row->document_bytes : null,
        ];
    }
}
