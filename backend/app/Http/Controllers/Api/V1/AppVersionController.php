<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public gate the mobile driver app hits on launch: it reports its platform +
 * installed version, and we answer whether a forced update is required (the
 * running build is older than the minimum the super-admin configured). No auth
 * or tenant context — the app may not be signed in yet.
 */
class AppVersionController extends Controller
{
    public function check(Request $request): JsonResponse
    {
        $data = $request->validate([
            'platform' => ['required', 'in:android,ios'],
            'version' => ['required', 'string', 'max:20'],
        ]);

        $min = Settings::get('app_min_'.$data['platform']);
        $storeUrl = Settings::get('app_'.$data['platform'].'_store_url');

        // Only force an update when a minimum is configured AND the running build
        // is strictly older; a malformed/absent minimum never blocks the app.
        $updateRequired = filled($min) && version_compare($data['version'], (string) $min, '<');

        return response()->json(['data' => [
            'update_required' => $updateRequired,
            'min_supported' => $min,
            'store_url' => $storeUrl,
        ]]);
    }
}
