<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Support\Models\ContactMessage;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Public: receives a submission from the landing page's contact form. */
class ContactController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:150'],
            'email' => ['required', 'email', 'max:255'],
            'phone' => ['nullable', 'string', 'max:60'],
            'message' => ['required', 'string', 'max:5000'],
        ]);

        ContactMessage::create([
            ...$data,
            'ip' => $request->ip(),
        ]);

        // The form only needs to know it arrived; the admin reads it in the inbox.
        return response()->json(['data' => ['received' => true]], 201);
    }
}
