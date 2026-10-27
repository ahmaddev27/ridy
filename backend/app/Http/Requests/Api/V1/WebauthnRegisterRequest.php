<?php

namespace App\Http\Requests\Api\V1;

class WebauthnRegisterRequest extends WebauthnCeremonyRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            ...parent::rules(),
            // "Pixel 8 von Ali" — optional; the UI caps it well below this.
            'alias' => ['nullable', 'string', 'max:64'],
        ];
    }

    public function alias(): ?string
    {
        $alias = $this->input('alias');

        return is_string($alias) ? $alias : null;
    }
}
