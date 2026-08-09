<?php

namespace App\Http\Requests\Api\V1\Admin;

use Illuminate\Foundation\Http\FormRequest;

class StoreCompanyRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // route is already gated by the super.admin middleware
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'country' => ['nullable', 'string', 'size:2'],
            'status' => ['nullable', 'string', 'in:active,disabled'],
            'uber_org_uuid' => ['nullable', 'uuid'],
            'proxy_url' => ['nullable', 'string', 'max:1000'],

            // Optional first manager — created with the company in one transaction.
            'manager_name' => ['nullable', 'required_with:manager_email', 'string', 'max:255'],
            'manager_email' => ['nullable', 'required_with:manager_password', 'email', 'unique:users,email'],
            'manager_password' => ['nullable', 'required_with:manager_email', 'string', 'min:8'],
        ];
    }
}
