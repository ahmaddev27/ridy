<?php

namespace App\Domain\Auth;

use Illuminate\Http\Request;
use Laravel\Sanctum\Events\TokenAuthenticated;
use Laravel\Sanctum\Guard;
use Laravel\Sanctum\Sanctum;

/**
 * A Sanctum guard that authenticates a personal-access BEARER token only.
 *
 * Sanctum's stock guard first asks the `web` session guard for a user (SPA cookie
 * auth, enabled for every /api request by statefulApi()). On the driver guard that
 * meant a dashboard manager's session resolved as a "driver" whose id was their
 * users.id — a foreign company's driver. This guard skips the session fallback
 * entirely, so `auth:driver` can only ever be satisfied by a token whose tokenable
 * matches the guard's provider (Driver).
 */
class BearerTokenGuard extends Guard
{
    public function __invoke(Request $request)
    {
        $token = $this->getTokenFromRequest($request);
        if (! $token) {
            return null;
        }

        $model = Sanctum::$personalAccessTokenModel;
        $accessToken = $model::findToken($token);

        if (! $this->isValidAccessToken($accessToken) || ! $this->supportsTokens($accessToken->tokenable)) {
            return null;
        }

        event(new TokenAuthenticated($accessToken));

        if ($this->trackLastUsedAt) {
            $this->updateLastUsedAt($accessToken);
        }

        return $accessToken->tokenable->withAccessToken($accessToken);
    }
}
