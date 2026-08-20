<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Ads\Models\Ad;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/** Serves the current live ad to a signed-in company for its Offers slot. */
class AdController extends Controller
{
    public function current(): JsonResponse
    {
        $ad = Ad::live()->inRandomOrder()->first();

        return response()->json(['data' => $ad ? $this->present($ad) : null]);
    }

    /** @return array<string, mixed> */
    private function present(Ad $ad): array
    {
        return [
            'id' => $ad->id,
            'title' => $ad->title,
            'body' => $ad->body,
            'image_url' => $ad->image_url,
            'link_url' => $ad->link_url,
            'cta_label' => $ad->cta_label,
        ];
    }
}
