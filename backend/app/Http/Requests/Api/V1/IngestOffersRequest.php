<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

/**
 * One batch of raw RAMEN offers — the SAME contract for the daemon
 * (internal/dispatch/ingest) and the extension (dispatch/offers/ingest), so the
 * two ingest paths can't drift. Individual offer fields are deliberately NOT
 * validated here: one malformed offer must be skipped by the ingestor, never
 * 422 the whole batch (which would drop every other driver's push).
 */
class IngestOffersRequest extends FormRequest
{
    /** Hard cap on offers per request — a RAMEN message carries a handful. */
    public const MAX_OFFERS = 200;

    public function authorize(): bool
    {
        // Auth is the route's middleware (dispatch secret, or Sanctum + ability).
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'offers' => ['required', 'array', 'max:'.self::MAX_OFFERS],
            'offers.*' => ['array'],
            'seq' => ['nullable', 'integer'],
        ];
    }
}
