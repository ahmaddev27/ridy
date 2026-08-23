<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Support\Models\ContactMessage;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Super-admin inbox for landing-page contact submissions. */
class ContactMessageController extends Controller
{
    public function index(): JsonResponse
    {
        $messages = ContactMessage::orderByDesc('created_at')->limit(500)->get()
            ->map(fn (ContactMessage $m) => $this->present($m));

        return response()->json([
            'data' => $messages,
            'meta' => ['unread' => ContactMessage::whereNull('read_at')->count()],
        ]);
    }

    /** Toggle/mark a message read or unread. */
    public function update(Request $request, ContactMessage $contactMessage): JsonResponse
    {
        $read = $request->boolean('read', true);
        $contactMessage->update(['read_at' => $read ? ($contactMessage->read_at ?? now()) : null]);

        return response()->json(['data' => $this->present($contactMessage->fresh())]);
    }

    public function destroy(ContactMessage $contactMessage): JsonResponse
    {
        $contactMessage->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    /** @return array<string, mixed> */
    private function present(ContactMessage $m): array
    {
        return [
            'id' => $m->id,
            'name' => $m->name,
            'email' => $m->email,
            'phone' => $m->phone,
            'message' => $m->message,
            'read' => $m->read_at !== null,
            'created_at' => $m->created_at?->toIso8601String(),
        ];
    }
}
