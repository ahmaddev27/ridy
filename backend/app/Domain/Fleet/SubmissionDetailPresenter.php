<?php

namespace App\Domain\Fleet;

use App\Domain\Fleet\Models\ElProfessorSubmission;
use Illuminate\Support\Facades\Storage;

/**
 * The full detail of one submission, as the driver who sent it sees it.
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
        'city' => 'city',
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
