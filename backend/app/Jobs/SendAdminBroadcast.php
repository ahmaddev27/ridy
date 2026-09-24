<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Str;

/**
 * Fans a super-admin's free-form broadcast out to a set of users, off the
 * request cycle. This job only SPLITS the audience: each small chunk is its own
 * {@see SendAdminBroadcastChunk} with its own timeout and retries. One long job
 * doing a bell insert + FCM + synchronous SMTP per recipient used to pass the
 * worker's 60 s timeout, get killed and re-run from the start — duplicating the
 * first recipients' bells/emails/pushes while the rest never got it, and blocking
 * the only worker (owner offer pushes, geocoding) the whole time.
 */
class SendAdminBroadcast implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /** Users per chunk job: each gets a bell, FCM and (synchronous) email. */
    private const USER_CHUNK = 25;

    /** Drivers per chunk job: a push only. */
    private const DRIVER_CHUNK = 200;

    public int $tries = 1;

    /**
     * @param  array<int, int>  $userIds
     * @param  array<int, int>  $driverIds  activated app drivers to push (no bell)
     */
    public function __construct(
        private readonly array $userIds,
        private readonly string $title,
        private readonly string $body,
        private readonly ?string $href = null,
        private readonly array $driverIds = [],
    ) {}

    public function handle(): void
    {
        // Stamped on every recipient's bell entry, so a retried chunk skips the
        // users it already reached instead of notifying them twice.
        $broadcastId = (string) Str::uuid();

        foreach (array_chunk($this->userIds, self::USER_CHUNK) as $chunk) {
            SendAdminBroadcastChunk::dispatch($broadcastId, $this->title, $this->body, $this->href, $chunk, []);
        }

        foreach (array_chunk($this->driverIds, self::DRIVER_CHUNK) as $chunk) {
            SendAdminBroadcastChunk::dispatch($broadcastId, $this->title, $this->body, $this->href, [], $chunk);
        }
    }
}
