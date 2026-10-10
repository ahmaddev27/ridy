<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Uber's verdict on one dispatch command, as the daemon read it off
 * `rejectOffers.offerResponse[0]`.
 *
 * `is_success` is required and strictly boolean: the whole feature turns on it,
 * and a missing or fuzzy value must not be able to read as "Uber accepted the
 * decline" — that would flip an offer the driver may still take.
 */
class DispatchCommandResultRequest extends FormRequest
{
    public function authorize(): bool
    {
        // Auth is the route's middleware (the shared dispatch secret).
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'is_success' => ['required', 'boolean'],
            // Uber's errorMsg, stored as-is for the measurement. Capped to the
            // column so a verbose GraphQL error can never 500 the report.
            'error' => ['nullable', 'string', 'max:255'],
            // offer_generated_at -> Uber's answer, measured by the daemon. The
            // number that says whether a human tap can beat Uber's window at all.
            'latency_ms' => ['nullable', 'integer', 'min:0'],
        ];
    }
}
