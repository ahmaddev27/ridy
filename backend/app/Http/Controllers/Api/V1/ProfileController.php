<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Api\V1\Admin\ImpersonationController;
use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

/**
 * The authenticated user edits their own account (name, email, password) —
 * used by both company managers and the super-admin.
 */
class ProfileController extends Controller
{
    /**
     * Token names that survive a password change: the browser extension keeps
     * feeding offers (its token is confined to ingest and can read nothing), so
     * revoking it would silently stop the company's offer capture.
     */
    private const TOKENS_KEPT_ON_PASSWORD_CHANGE = ['ridy-extension'];

    public function update(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'required', 'email', Rule::unique('users', 'email')->ignore($user->id)],
            'password' => ['sometimes', 'required', 'string', 'min:8', 'confirmed'],
        ]);

        // A super-admin acting as a company must not take over that company's
        // login — credentials are the account owner's to change.
        $changesCredentials = isset($data['email']) || isset($data['password']);
        abort_if($changesCredentials && $this->impersonating($request), 403, 'impersonation_forbidden');

        if (isset($data['name'])) {
            $user->name = $data['name'];
        }
        if (isset($data['email'])) {
            $user->email = $data['email'];
        }
        if (isset($data['password'])) {
            $user->password = Hash::make($data['password']);
        }
        $user->save();

        if (isset($data['password'])) {
            // Evict bearer tokens minted under the old password (owner-app, API
            // tokens) so a password change actually locks out a stolen token. The
            // dashboard session itself is not a token and stays signed in.
            $user->tokens()->whereNotIn('name', self::TOKENS_KEPT_ON_PASSWORD_CHANGE)->delete();
        }

        return response()->json(['data' => new UserResource($user)]);
    }

    private function impersonating(Request $request): bool
    {
        return $request->hasSession() && $request->session()->has(ImpersonationController::KEY);
    }
}
