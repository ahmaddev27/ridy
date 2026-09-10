<?php

namespace App\Domain\Notifications\Contracts;

/**
 * A push transport that can deliver ONE message to MANY devices concurrently.
 *
 * Offer pushes happen inside Uber's ~5-second accept window, so sending device by
 * device does not scale: a driver with two phones in a company where three managers
 * run owner mode was five sequential HTTP calls, each with a 5 s timeout, all of it
 * holding the daemon's ingest request open.
 *
 * Kept separate from {@see PushSender} so a transport that has nothing to gain from
 * batching (and every test double) implements only the single-device contract.
 */
interface SendsPushInBulk
{
    /**
     * @param  array<int, string>  $deviceTokens
     * @param  array<string, mixed>  $data  arbitrary key/value payload for the app
     * @return int number of devices the transport accepted
     */
    public function sendMany(array $deviceTokens, string $title, string $body, array $data = []): int;
}
