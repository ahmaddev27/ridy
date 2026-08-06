<?php

namespace App\Domain\Notifications\Contracts;

/**
 * Sends a push notification to one device. Implementations wrap FCM/APNs; the
 * app depends on this contract so the transport can be swapped or faked.
 */
interface PushSender
{
    /**
     * @param  array<string, mixed>  $data  arbitrary key/value payload for the app
     * @return bool whether the send was accepted by the transport
     */
    public function send(string $deviceToken, string $title, string $body, array $data = []): bool;
}
