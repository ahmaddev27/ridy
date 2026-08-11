<?php

namespace App\Http\Requests\Api\V1\Admin;

use Illuminate\Foundation\Http\FormRequest;

class UpdateCompanyRequest extends FormRequest
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
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'country' => ['nullable', 'string', 'size:2'],
            'status' => ['nullable', 'string', 'in:active,disabled'],
            'subscription_ends_at' => ['sometimes', 'nullable', 'date'],
            'uber_org_uuid' => ['nullable', 'uuid'],
            // Present only when the admin edits it; empty string clears it (→ global proxy).
            'proxy_url' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ];
    }
}
