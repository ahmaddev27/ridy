<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Notifications\Notifier;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The authenticated dashboard user manages their per-category web-push and email
 * toggles. The in-app bell is always on and is never represented here. Missing
 * entries mean the channel is enabled (opt-out defaults).
 */
class NotificationPrefsController extends Controller
{
    private const CHANNELS = ['push', 'email'];

    /** Current preferences for every channel/category, filled with defaults. */
    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->resolve($request->user())]);
    }

    /** Validate and persist the full preference matrix. */
    public function update(Request $request): JsonResponse
    {
        $rules = [];
        foreach (self::CHANNELS as $channel) {
            $rules[$channel] = ['sometimes', 'array'];
            foreach (Notifier::CATEGORIES as $category) {
                $rules["$channel.$category"] = ['sometimes', 'boolean'];
            }
        }

        $data = $request->validate($rules);

        $prefs = [];
        foreach (self::CHANNELS as $channel) {
            foreach (Notifier::CATEGORIES as $category) {
                $prefs[$channel][$category] = (bool) ($data[$channel][$category] ?? true);
            }
        }

        $user = $request->user();
        $user->notification_prefs = $prefs;
        $user->save();

        return response()->json(['data' => $this->resolve($user)]);
    }

    /**
     * @return array{push: array<string, bool>, email: array<string, bool>}
     */
    private function resolve($user): array
    {
        $resolved = [];
        foreach (self::CHANNELS as $channel) {
            foreach (Notifier::CATEGORIES as $category) {
                $resolved[$channel][$category] = $user->wantsChannel($channel, $category);
            }
        }

        return $resolved;
    }
}
