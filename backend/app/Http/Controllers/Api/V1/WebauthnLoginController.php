<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Auth\Webauthn\PasskeyAuthenticator;
use App\Http\Controllers\Concerns\RespondsSuspendedLogin;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\WebauthnCeremonyRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

/**
 * Passkey sign-in for the dashboard — the public pair beside `POST login`.
 * Mirrors {@see AuthController::login} from the moment the credential is
 * verified: same suspended-company gate, same session tail, same resource.
 */
class WebauthnLoginController extends Controller
{
    use RespondsSuspendedLogin;

    public function __construct(private readonly PasskeyAuthenticator $passkeys) {}

    /** Username-less: the options name no account and list no credentials. */
    public function options(): JsonResponse
    {
        return response()->json($this->passkeys->start());
    }

    public function login(WebauthnCeremonyRequest $request): JsonResponse
    {
        $user = $this->passkeys->authenticate($request->ceremonyId(), $request->credential(), User::class);

        // A suspended company (disabled / banned / expired) cannot sign in,
        // whatever the credential. Super-admins (no tenant) are never gated.
        $user->load('tenant');
        $reason = $user->tenant?->stateReason();
        if ($reason !== null) {
            return $this->suspendedLoginResponse($user->tenant, $reason);
        }

        // D4: a passkey is device-bound, so a passkey login always remembers
        // the device — there is no checkbox to carry.
        if ($request->hasSession()) {
            Auth::guard('web')->login($user, true);
            $request->session()->regenerate();
        }

        return (new UserResource($user))->response();
    }
}
