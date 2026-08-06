<?php

namespace App\Http\Controllers\Api\V1;

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
                'title' => $n->data['title'] ?? '',
                'body' => $n->data['body'] ?? '',
                'type' => $n->data['type'] ?? null,
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
}
