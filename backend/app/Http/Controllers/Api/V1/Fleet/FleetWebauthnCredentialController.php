<?php

namespace App\Http\Controllers\Api\V1\Fleet;

use App\Domain\Auth\Webauthn\PasskeyScope;
use App\Http\Controllers\Api\V1\WebauthnCredentialController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The fleet owner's app passkeys — the dashboard controller's shapes, scoped
 * to the app: the rows it writes, lists and removes carry scope 'app', so they
 * never open the dashboard and the dashboard's never show up here.
 *
 * Mounted in the `fleet` group behind the read-only `fleet:read` token. Like
 * the driver, an owner in the app signed in with an emailed code and has no
 * password step-up to repeat; the dashboard's stays untouched.
 */
class FleetWebauthnCredentialController extends WebauthnCredentialController
{
    protected function scope(): PasskeyScope
    {
        return PasskeyScope::App;
    }

    public function registerOptions(Request $request): JsonResponse
    {
        return response()->json($this->registrar->start($request->user(), $this->scope()));
    }
}
