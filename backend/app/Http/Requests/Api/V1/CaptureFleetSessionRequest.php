<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

class CaptureFleetSessionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'uber_org_uuid' => ['required', 'string'],
            'uber_org_name' => ['nullable', 'string', 'max:255'],
            'cookies' => ['required', 'array', 'min:1'],
            'cookies.*.name' => ['required', 'string'],
            'cookies.*.value' => ['required', 'string'],
            // supplier.uber.com-scoped jar (optional — older extensions omit it).
            'supplier_cookies' => ['nullable', 'array'],
            'supplier_cookies.*.name' => ['required_with:supplier_cookies', 'string'],
            'supplier_cookies.*.value' => ['required_with:supplier_cookies', 'string'],
            'expires_at' => ['nullable', 'date'],
            // true = the manager pressed Connect; false/absent = the extension's
            // silent auto-capture (refused while the tenant is autolink-blocked).
            'manual' => ['nullable', 'boolean'],
        ];
    }
}
