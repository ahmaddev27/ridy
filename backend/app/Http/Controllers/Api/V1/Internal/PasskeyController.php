<?php

namespace App\Http\Controllers\Api\V1\Internal;

use App\Domain\Dispatch\PasskeyService;
use App\Domain\Dispatch\PasskeySettings;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Internal (X-Dispatch-Secret) endpoints for uber-auth's passkey registration (docs/29).
 * Receive-and-store only. The credential is NEVER returned from here.
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
}
