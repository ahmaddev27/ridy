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
            // Present but NULLABLE, and the three values mean three different
            // things: true = Uber accepted the decline, false = Uber refused it,
            // null = we never got a verdict (a timeout, a dead proxy, a 5xx, an
            // unreadable body). Only `true` may settle the offer, and null must not
            // be recorded as a refusal — Uber may have applied a call whose answer
            // never reached us.
            'is_success' => ['present', 'nullable', 'boolean'],
            // Uber's errorMsg, stored as-is for the measurement. Capped to the
            // column so a verbose GraphQL error can never 500 the report.
            'error' => ['nullable', 'string', 'max:255'],
            // How long the daemon's own call to Uber took. The end-to-end figure —
            // how old the offer was when Uber answered, which is what the unknown
            // deadline actually turns on — is computed server-side from
            // offer_generated_at, the column only this side holds.
            'latency_ms' => ['nullable', 'integer', 'min:0'],
        ];
    }
}
