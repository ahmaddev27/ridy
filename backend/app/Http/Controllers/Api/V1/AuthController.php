<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Auth\PasswordCheck;
use App\Http\Controllers\Api\V1\Admin\ImpersonationController;
use App\Http\Controllers\Concerns\RespondsSuspendedLogin;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\LoginRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    use RespondsSuspendedLogin;

    public function login(LoginRequest $request): JsonResponse
    {
        $user = User::where('email', $request->string('email'))->first();

        // Constant-work check: an unknown email costs the same bcrypt as a real one.
        if (! PasswordCheck::matches($user?->password, (string) $request->string('password'))) {
            throw ValidationException::withMessages([
                'email' => [__('auth.failed')],
            ]);
        }

        // A suspended company (disabled / banned / expired) cannot sign in — nor
        // can its drivers. Super-admins (no tenant) are never gated.
        $user->load('tenant');
        $reason = $user->tenant?->stateReason();
        if ($reason !== null) {
            // Reached only after the password check above, so the caller owns the
            // account — the shared answer may carry the payment reference.
            return $this->suspendedLoginResponse($user->tenant, $reason);
        }

        // Establish a session for the SPA cookie flow when a session is available.
        // "Remember me" issues a long-lived remember cookie, so the session
        // survives browser restarts / session expiry.
        if ($request->hasSession()) {
            Auth::guard('web')->login($user, $request->boolean('remember'));
            $request->session()->regenerate();
        }

        $user->load('tenant');

        return (new UserResource($user))->response()->setStatusCode(200);
    }

    public function me(Request $request): JsonResponse
    {
        // Surface impersonation so the dashboard can show an "acting as company"
        // banner with a stop control (the session key is set by the admin's
        // impersonate/start).
        $impersonating = $request->hasSession()
            && $request->session()->has(ImpersonationController::KEY);

        return (new UserResource($request->user()->load('tenant')))
            ->additional(['impersonating' => $impersonating])
            ->response();
    }

    public function logout(Request $request): Response
    {
        if ($request->hasSession()) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->noContent();
    }
}
