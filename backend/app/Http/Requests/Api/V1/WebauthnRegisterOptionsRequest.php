<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Starting a passkey enrolment is a step-up (security review B2): the
 * signed-in user re-proves the account password before a ceremony is handed
 * out, so a hijacked dashboard session alone cannot plant an authenticator
 * that would outlive logout and password resets. The ceremony is owner-bound
 * and single-use, so `POST register` is covered through this gate and needs
 * no password of its own.
 */
class WebauthnRegisterOptionsRequest extends FormRequest
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
            // Checked against the sanctum principal — the cookie session or
            // token this request authenticated with, never a guard of its own.
            'password' => ['required', 'string', 'current_password:sanctum'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        // A code, like `otp_incorrect`: the UI maps `errors.password` itself.
        return ['password.current_password' => 'password_incorrect'];
    }
}
