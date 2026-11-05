<?php

namespace App\Http\Controllers\Api\V1\Internal;

use App\Domain\Dispatch\PasskeyService;
use App\Domain\Dispatch\PasskeySettings;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Internal (X-Dispatch-Secret) endpoints for uber-auth's passkey registration (docs/31).
 * Receives and stores the credential; it leaves ONLY via credential() (same flags), for co-browse injection.
 */
class PasskeyController extends Controller
{
    public function show(Tenant $tenant, PasskeySettings $settings, PasskeyService $passkeys): JsonResponse
    {
        return response()->json(['data' => [
            'enabled' => $settings->availableFor($tenant),
            'registered' => $passkeys->hasActive($tenant->id),
        ]]);
    }

    public function store(Request $request, Tenant $tenant, PasskeySettings $settings, PasskeyService $passkeys): JsonResponse
    {
        abort_unless($settings->availableFor($tenant), 403, 'Passkey registration is not enabled.');

        $data = $request->validate([
            'credential' => ['required', 'array'],
            'credential.credentialId' => ['required', 'string', 'max:1024'],
            'credential.privateKey' => ['required', 'string', 'max:8192'],
            'credential.rpId' => ['required', 'string', 'max:255'],
            'credential.account' => ['nullable', 'string', 'max:255'],
            'credential.userHandle' => ['nullable', 'string', 'max:1024'],
            'credential.signCount' => ['nullable', 'integer', 'min:0'],
            'credential.isResidentCredential' => ['nullable', 'boolean'],
            'uber_org_uuid' => ['nullable', 'string', 'max:64'],
        ]);

        // Idempotent: never overwrite a live passkey (the old one stays valid on Uber's side).
        if ($passkeys->hasActive($tenant->id)) {
            return response()->json(['data' => ['registered' => true, 'created' => false]]);
        }

        $passkeys->store($tenant, $data['credential'], $data['uber_org_uuid'] ?? null);

        return response()->json(['data' => ['registered' => true, 'created' => true]]);
    }

    /**
     * The decrypted, CDP-ready credential for co-browse injection (internal secret only, same
     * flags as registration). 404 when nothing usable. Never logged; no-store.
     */
    public function credential(Tenant $tenant, PasskeyService $passkeys): JsonResponse
    {
        $credential = $passkeys->credentialForInjection($tenant);
        abort_if($credential === null, 404, 'No usable passkey.');

        // A fetch for injection is not proof of a sign-in: uber-auth reports that via used()/loginFailed().
        return response()->json(['data' => $credential])->header('Cache-Control', 'no-store');
    }

    /** uber-auth confirms a passkey sign-in landed and reports the authenticator's new signCount. */
    public function used(Request $request, Tenant $tenant, PasskeyService $passkeys): JsonResponse
    {
        abort_unless($passkeys->isEnabledFor($tenant), 404);
        // signCount is optional: a landed sign-in whose counter could not be read still resets the breaker.
        $data = $request->validate(['signCount' => ['nullable', 'integer', 'min:0']]);
        $passkeys->recordSignIn($tenant->id, isset($data['signCount']) ? (int) $data['signCount'] : null);

        return response()->json(['data' => ['recorded' => true]]);
    }

    /** uber-auth reports an injected passkey that did NOT sign in (feeds the consecutive-failure breaker). */
    public function loginFailed(Tenant $tenant, PasskeyService $passkeys): JsonResponse
    {
        abort_unless($passkeys->isEnabledFor($tenant), 404);
        $passkeys->recordLoginResult($tenant->id, false);

        return response()->json(['data' => ['recorded' => true]]);
    }

    /** uber-auth reports a failed attempt (incl. `session_lost`); recorded and logged loudly. */
    public function failure(Request $request, Tenant $tenant, PasskeyService $passkeys): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:190']]);
        $passkeys->recordFailure($tenant->id, $data['reason']);

        return response()->json(['data' => ['recorded' => true]]);
    }
}
