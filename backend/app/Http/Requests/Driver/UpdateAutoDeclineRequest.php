<?php

namespace App\Http\Requests\Driver;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The driver's own auto-decline config. Money is integer cents (`value_e2`) —
 * `integer` rejects 9.5, so a float can never be stored.
 */
class UpdateAutoDeclineRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'enabled' => ['required', 'boolean'],
            'rules' => ['sometimes', 'array'],
            'rules.min_fare' => ['sometimes', 'array'],
            'rules.min_fare.enabled' => ['required_with:rules.min_fare', 'boolean'],
            'rules.min_fare.value_e2' => ['sometimes', 'integer', 'min:0', 'max:1000000'],
            'rules.reject_cities' => ['sometimes', 'array'],
            'rules.reject_cities.enabled' => ['required_with:rules.reject_cities', 'boolean'],
            'rules.reject_cities.cities' => ['sometimes', 'array', 'max:50'],
            'rules.reject_cities.cities.*' => ['nullable', 'string', 'max:80'],
            'rules.max_pickup_distance' => ['sometimes', 'array'],
            'rules.max_pickup_distance.enabled' => ['required_with:rules.max_pickup_distance', 'boolean'],
            'rules.max_pickup_distance.km' => ['sometimes', 'numeric', 'min:0', 'max:1000'],
            'rules.max_trip_distance' => ['sometimes', 'array'],
            'rules.max_trip_distance.enabled' => ['required_with:rules.max_trip_distance', 'boolean'],
            'rules.max_trip_distance.km' => ['sometimes', 'numeric', 'min:0', 'max:1000'],
        ];
    }
}
