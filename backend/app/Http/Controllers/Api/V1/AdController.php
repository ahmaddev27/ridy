<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Ads\Models\Ad;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/** Serves the current live ad to a signed-in company for its Offers slot. */
class AdController extends Controller
{
    public function current(): JsonResponse
    {
        $ads = Ad::live()
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (Ad $ad) => $this->present($ad))
            ->all();

        return response()->json(['data' => $ads]);
    }

    /** Serves an uploaded ad image by filename. Public so <img> loads without auth. */
    public function media(string $filename): BinaryFileResponse
    {
        $path = storage_path('app/public/ads/'.basename($filename));
        abort_unless(is_file($path), 404);

        return response()->file($path);
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
