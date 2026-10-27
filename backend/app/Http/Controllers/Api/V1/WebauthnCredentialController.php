<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Auth\Webauthn\PasskeyRegistrar;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\WebauthnRegisterRequest;
use App\Http\Resources\WebauthnCredentialResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * A signed-in user's passkeys: enrol, list, remove. Mounted inside the
 * `auth:sanctum + user.account + dashboard.only` group, so a cookie session
 * reaches it and a scoped token (extension, fleet-owner app) does not.
 */
class WebauthnCredentialController extends Controller
{
    public function __construct(private readonly PasskeyRegistrar $registrar) {}

    public function registerOptions(Request $request): JsonResponse
    {
        return response()->json($this->registrar->start($request->user()));
    }

    public function register(WebauthnRegisterRequest $request): JsonResponse
    {
        $credential = $this->registrar->finish(
            $request->user(),
            $request->ceremonyId(),
            $request->credential(),
            $request->alias(),
        );

        return (new WebauthnCredentialResource($credential))->response()->setStatusCode(201);
    }

    public function index(Request $request): AnonymousResourceCollection
    {
        return WebauthnCredentialResource::collection(
            $request->user()->webauthnCredentials()->latest()->get(),
        );
    }

    /** Scoped to the owner: someone else's credential reads as absent, never as forbidden. */
    public function destroy(Request $request, string $credential): Response
    {
        $request->user()->webauthnCredentials()->whereKey($credential)->firstOrFail()->delete();

        return response()->noContent();
    }
}
