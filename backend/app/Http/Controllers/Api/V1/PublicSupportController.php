<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;

/**
 * Public support-contact details, readable by unauthenticated marketing/auth
 * pages (registration, login) so they can offer a "contact support" shortcut.
 * Only the customer-facing WhatsApp number is exposed — never internal config.
 */
class PublicSupportController extends Controller
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => [
            'whatsapp' => Settings::get('support_whatsapp'),
        ]]);
    }
}
