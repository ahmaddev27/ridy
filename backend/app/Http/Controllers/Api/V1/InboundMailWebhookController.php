<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\Inbound\InboundWebhookService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

/**
 * SendGrid Inbound Parse target (docs/27 variant B over HTTPS). Authenticated by the
 * shared secret middleware. A dropped message answers 200 on purpose - the sender must not
 * retry junk - and the reason is a coarse code only, never message content. Only an
 * infrastructure failure answers 503 so SendGrid retries.
 */
class InboundMailWebhookController extends Controller
{
    public function receive(Request $request, InboundWebhookService $webhook): JsonResponse
    {
        $payload = $request->validate([
            'to' => ['nullable', 'string', 'max:2000'],
            'envelope' => ['nullable', 'string', 'max:2000'],
            'email' => ['nullable', 'string', 'max:'.InboundWebhookService::MAX_BYTES],
            'headers' => ['nullable', 'string', 'max:65536'],
            'subject' => ['nullable', 'string', 'max:998'],
            'text' => ['nullable', 'string', 'max:'.InboundWebhookService::MAX_BYTES],
            'html' => ['nullable', 'string', 'max:'.InboundWebhookService::MAX_BYTES],
        ]);

        try {
            $outcome = $webhook->receive($payload);
        } catch (Throwable $e) {
            // Class only: the message text could echo the email.
            report(new \RuntimeException('inbound-mail webhook failed: '.$e::class));

            return response()->json(['message' => 'Temporarily unavailable.'], 503);
        }

        return response()->json(['data' => ['outcome' => $outcome]]);
    }
}
