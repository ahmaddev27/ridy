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
            'cookies' => ['required', 'array', 'min:1'],
            'cookies.*.name' => ['required', 'string'],
            'cookies.*.value' => ['required', 'string'],
            'expires_at' => ['nullable', 'date'],
        ];
    }
}
