<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Issues a personal access token the Ridy browser extension uses to post the
 * captured Uber session. Minted from the manager's authenticated dashboard
 * session, so no password ever reaches the extension.
 */
class ExtensionController extends Controller
{
    public function issueToken(Request $request): JsonResponse
    {
        $user = $request->user();

        // One active extension token per user — replace any previous one.
        $user->tokens()->where('name', 'ridy-extension')->delete();

        $token = $user->createToken('ridy-extension', ['fleet-session:write'])->plainTextToken;

        return response()->json(['data' => ['token' => $token]]);
    }
}
