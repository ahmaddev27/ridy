<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Ads\Models\Ad;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/** Super-admin management of platform-wide promotional ads. */
class AdController extends Controller
{
    public function index(): JsonResponse
    {
        $ads = Ad::orderByDesc('active')->orderByDesc('created_at')->get()->map(fn (Ad $ad) => $this->present($ad));

        return response()->json(['data' => $ads]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $data['active'] = $data['active'] ?? true;
        $ad = Ad::create($data);

        return response()->json(['data' => $this->present($ad)], 201);
    }

    /** The per-device image columns the ad now uses (+ the legacy single image). */
    private const IMAGE_FIELDS = ['image_url', 'image_mobile', 'image_tablet', 'image_desktop'];

    public function update(Request $request, Ad $ad): JsonResponse
    {
        $data = $this->validated($request);
        // Delete any device image that was replaced, so old uploads don't orphan.
        foreach (self::IMAGE_FIELDS as $field) {
            if (array_key_exists($field, $data) && $data[$field] !== $ad->{$field}) {
                $this->deleteImage($ad->{$field});
            }
        }
        $ad->update($data);

        return response()->json(['data' => $this->present($ad->fresh())]);
    }

    public function destroy(Ad $ad): JsonResponse
    {
        foreach (self::IMAGE_FIELDS as $field) {
            $this->deleteImage($ad->{$field});
        }
        $ad->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    /** Remove an uploaded ad image from disk (ignores external/empty URLs). */
    private function deleteImage(?string $imageUrl): void
    {
        if ($imageUrl === null || ! str_contains($imageUrl, '/ads/media/')) {
            return;
        }
        Storage::disk('public')->delete('ads/'.basename($imageUrl));
    }

    /** Upload an ad image; returns a same-origin URL to store in image_url. */
    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'image' => ['required', 'image', 'mimes:jpeg,jpg,png,webp,gif', 'max:4096'],
        ]);
        $path = $request->file('image')->store('ads', 'public');

        return response()->json(['data' => ['url' => '/api/v1/ads/media/'.basename($path)]]);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request): array
    {
        // A scheme-less link like "www.example.com" is what admins actually type;
        // normalize it to a valid URL before validation instead of rejecting it.
        if ($request->filled('link_url')) {
            $request->merge(['link_url' => $this->normalizeUrl($request->input('link_url'))]);
        }

        return $request->validate([
            'title' => ['nullable', 'string', 'max:255'],
            'body' => ['nullable', 'string', 'max:2000'],
            // image_url is set from our own upload endpoint (a relative same-origin
            // path), so it is a trusted string, not an external absolute URL.
            'image_url' => ['nullable', 'string', 'max:2048'],
            // The three device images are the ad now — all required.
            'image_mobile' => ['required', 'string', 'max:2048'],
            'image_tablet' => ['required', 'string', 'max:2048'],
            'image_desktop' => ['required', 'string', 'max:2048'],
            'link_url' => ['nullable', 'url', 'max:2048'],
            'cta_label' => ['nullable', 'string', 'max:80'],
            'active' => ['boolean'],
            'starts_at' => ['nullable', 'date'],
            'ends_at' => ['nullable', 'date', 'after_or_equal:starts_at'],
        ]);
    }

    /** Prepend https:// when the admin omitted the scheme. */
    private function normalizeUrl(string $url): string
    {
        $url = trim($url);

        return preg_match('#^https?://#i', $url) ? $url : 'https://'.$url;
    }

    /** @return array<string, mixed> */
    private function present(Ad $ad): array
    {
        return [
            'id' => $ad->id,
            'title' => $ad->title,
            'body' => $ad->body,
            'image_url' => $ad->image_url,
            'image_mobile' => $ad->image_mobile,
            'image_tablet' => $ad->image_tablet,
            'image_desktop' => $ad->image_desktop,
            'link_url' => $ad->link_url,
            'cta_label' => $ad->cta_label,
            'active' => $ad->active,
            'starts_at' => $ad->starts_at?->toIso8601String(),
            'ends_at' => $ad->ends_at?->toIso8601String(),
        ];
    }
}
