<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The second half of a ceremony: the echoed ceremony id plus the browser's
 * PublicKeyCredential in its `toJSON()` shape. Only the envelope is validated
 * here — the engine parses and verifies `response` itself, and tolerates the
 * extras newer browsers add (publicKey, publicKeyAlgorithm, authenticatorData,
 * clientExtensionResults).
 */
class WebauthnCeremonyRequest extends FormRequest
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
            'ceremony_id' => ['required', 'string', 'max:64'],
            'credential' => ['required', 'array'],
            // The column is 510 chars; a real credential id is far shorter.
            'credential.id' => ['required', 'string', 'max:510'],
            'credential.type' => ['required', 'string', 'in:public-key'],
            'credential.rawId' => ['sometimes', 'string', 'max:510'],
            'credential.response' => ['sometimes', 'array'],
        ];
    }

    public function ceremonyId(): string
    {
        return $this->string('ceremony_id')->toString();
    }

    /**
     * @return array<string, mixed>
     */
    public function credential(): array
    {
        return $this->array('credential');
    }
}
