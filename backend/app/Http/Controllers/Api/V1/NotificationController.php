<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Notifications\Models\UserPushToken;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $items = $request->user()->notifications()->latest()->take(50)->get()
            ->map(fn ($n) => [
                'id' => $n->id,
                'type' => $n->data['type'] ?? null,
                // Structured params the frontend renders in the user's language.
                'params' => $n->data['params'] ?? [],
                'href' => $n->data['href'] ?? null,
                // Legacy pre-rendered strings (older notifications) as a fallback.
                'title' => $n->data['title'] ?? null,
                'body' => $n->data['body'] ?? null,
                'read' => $n->read_at !== null,
                'created_at' => $n->created_at?->toIso8601String(),
            ]);

        return response()->json([
            'data' => $items,
            'meta' => ['unread' => $request->user()->unreadNotifications()->count()],
        ]);
    }

    public function markRead(Request $request): Response
    {
        $request->user()->unreadNotifications->markAsRead();

        return response()->noContent();
    }

    /** Delete one of the user's own notifications. */
    public function destroy(Request $request, string $id): Response
    {
        $request->user()->notifications()->whereKey($id)->delete();

        return response()->noContent();
    }

    /** Clear all of the user's notifications. */
    public function clear(Request $request): Response
    {
        $request->user()->notifications()->delete();

        return response()->noContent();
    }

    /**
     * Register (idempotently) this browser's FCM token for web push, and remember
     * the user's dashboard language so pushes are written in it.
     */
    public function registerDevice(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string', 'max:512'],
            'locale' => ['nullable', 'in:de,en,ar'],
        ]);

        UserPushToken::updateOrCreate(
            ['token' => $data['token']],
            ['user_id' => $request->user()->id, 'platform' => 'web', 'last_used_at' => now()],
        );

        if (! empty($data['locale']) && $request->user()->locale !== $data['locale']) {
            $request->user()->forceFill(['locale' => $data['locale']])->save();
        }

        return response()->json(['data' => ['registered' => true]]);
    }

    public function unregisterDevice(Request $request): Response
    {
        UserPushToken::where('user_id', $request->user()->id)
            ->where('token', (string) $request->input('token'))
            ->delete();

        return response()->noContent();
    }
}
