<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\LoginRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(LoginRequest $request): JsonResponse
    {
        $user = User::where('email', $request->string('email'))->first();

        if (! $user || ! Hash::check((string) $request->string('password'), $user->password)) {
            throw ValidationException::withMessages([
                'email' => [__('auth.failed')],
            ]);
        }

        // A suspended company (disabled / banned / expired) cannot sign in — nor
        // can its drivers. Super-admins (no tenant) are never gated.
        $user->load('tenant');
        $reason = $user->tenant?->stateReason();
        if ($reason !== null) {
            return response()->json([
                'message' => 'account_suspended',
                'reason' => $reason,
                'support_email' => Settings::get('support_email'),
                'support_whatsapp' => Settings::get('support_whatsapp'),
            ], 403);
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
            && $request->session()->has(\App\Http\Controllers\Api\V1\Admin\ImpersonationController::KEY);

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
