<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Fleet\Models\AppRating;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * In-app rating: the driver's stars (and, for low scores, a typed note). Tenant and
 * driver come from the token, never the body. One row per driver; a re-submit replaces it.
 */
class DriverAppRatingController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'stars' => ['required', 'integer', 'between:1,5'],
            'feedback' => ['nullable', 'string', 'max:1000'],
            'platform' => ['required', 'in:android,ios'],
            'app_version' => ['nullable', 'string', 'max:20'],
        ]);

        $driver = $request->user();
        $feedback = isset($data['feedback']) ? trim($data['feedback']) : '';

        AppRating::withoutGlobalScopes()->updateOrCreate(
            ['driver_id' => $driver->id],
            [
                'tenant_id' => $driver->tenant_id,
                'stars' => $data['stars'],
                'feedback' => $feedback === '' ? null : $feedback,
                'platform' => $data['platform'],
                'app_version' => $data['app_version'] ?? null,
            ],
        );

        return response()->json(['data' => ['saved' => true]]);
    }
}
