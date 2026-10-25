<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Geo\PostalCodes;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * The authoritative city for a postal code, for the receipt screen.
 *
 * The driver no longer types a receipt's city, and the OCR's guess at a city
 * line is the weakest field it reads. A PLZ it reads is far more reliable, so
 * the app asks here for the town that PLZ belongs to. Same table, same rule as
 * everywhere else: the authoritative city wins over a guess.
 */
class DriverPostalCodeController extends Controller
{
    public function show(string $plz): JsonResponse
    {
        $key = PostalCodes::normalize($plz);
        $city = $key === null ? null : PostalCodes::city($key);

        if ($city === null) {
            return response()->json(['message' => 'Unknown postal code.'], 404);
        }

        return response()->json(['data' => ['plz' => $key, 'city' => $city]]);
    }
}
