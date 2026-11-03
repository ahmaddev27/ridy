<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Auth\Webauthn\PasskeyRegistrar;
use App\Domain\Auth\Webauthn\PasskeyScope;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\WebauthnRegisterOptionsRequest;
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
    public function __construct(protected readonly PasskeyRegistrar $registrar) {}

    /** The front door this controller's passkeys open; subclasses for other doors override it. */
    protected function scope(): PasskeyScope
    {
        return PasskeyScope::Dashboard;
    }

    /** The step-up: the request re-proves the account password before a ceremony is parked. */
    public function registerOptions(WebauthnRegisterOptionsRequest $request): JsonResponse
    {
        return response()->json($this->registrar->start($request->user(), $this->scope()));
    }

    public function register(WebauthnRegisterRequest $request): JsonResponse
    {
        $credential = $this->registrar->finish(
            $request->user(),
            $request->ceremonyId(),
            $request->credential(),
            $request->alias(),
            $this->scope(),
        );

        return (new WebauthnCredentialResource($credential))->response()->setStatusCode(201);
    }

    public function index(Request $request): AnonymousResourceCollection
    {
        return WebauthnCredentialResource::collection(
            $request->user()->webauthnCredentialsIn($this->scope())->latest()->get(),
        );
    }

    /** Scoped to the owner: someone else's credential reads as absent, never as forbidden. */
    public function destroy(Request $request, string $credential): Response
    {
        $request->user()->webauthnCredentialsIn($this->scope())->whereKey($credential)->firstOrFail()->delete();

        return response()->noContent();
    }
}
