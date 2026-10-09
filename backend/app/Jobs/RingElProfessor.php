<?php

namespace App\Jobs;

use App\Domain\Fleet\Models\ElProfessorSubmission;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Tell El-Professor that a submission is ready for it to fetch.
 *
 * ## The ring carries nothing, and that is the whole design
 *
 * Four fields — partner, fleet, submission, subject — and no payload, no photo,
 * no credential. El-Professor then fetches the submission from
 * `GET elprofessor/submissions/{uuid}` with the token this side issued, which it
 * holds sealed.
 *
 * The owner chose this on 08.10.2026 after the alternative was measured and
 * failed: El-Professor's intake authenticates with that same token, and
 * **Sanctum stores only a hash**, so this side cannot replay it. Sealing the
 * plaintext here at issue time was the other candidate and was rejected — it
 * would keep a replayable secret at rest, readable by anyone with this database
 * and APP_KEY.
 *
 * ## It is not the delivery, only the doorbell
 *
 * A ring that never arrives loses nothing: El-Professor's operator has a button
 * that asks what is waiting. So this job does not retry for ever and does not
 * fail loudly — it tries three times and leaves the submission `pending`, which
 * is precisely the state the catch-up reads. **Do not add a scheduler here on
 * the grounds that a lost ring is a lost receipt; it is not.**
 *
 * ## Unconfigured means silent, not broken
 *
 * With no `intake_url` or `anon_key` the job returns without a request. This
 * side is a live product whose operator may never configure the link, and a job
 * that logged an error every time a driver submitted something would be noise
 * in a log somebody reads for real failures.
 */
class RingElProfessor implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public int $backoff = 30;

    /** Below the worker's retry_after, like every other job here. */
    public int $timeout = 20;

    public bool $failOnTimeout = true;

    /**
     * Scalar ids only, as every job in this codebase takes: a serialised model
     * in a queue payload is a snapshot that can be stale by the time a worker
     * runs it.
     */
    public function __construct(
        private readonly int $submissionId,
    ) {}

    public function handle(): void
    {
        $url = (string) config('elprofessor.intake_url', '');
        $key = (string) config('elprofessor.anon_key', '');
        if ($url === '' || $key === '') {
            return;
        }

        // The worker has no tenant context, so the global scope is dropped and
        // the tenant is read off the row — the pattern every job here follows.
        $row = ElProfessorSubmission::query()
            ->withoutGlobalScopes()
            ->find($this->submissionId);

        if ($row === null || ! $row->isPending()) {
            // Already fetched, already decided, or gone. A ring for it would be
            // answered and ignored, so it is not sent.
            return;
        }

        $response = Http::withToken($key)
            ->acceptJson()
            ->timeout(10)
            ->post($url, [
                'kind' => 'doorbell',
                'partner' => 'reidey',
                // El-Professor resolves this to one of its companies. It is our
                // tenant id, which it stored when the operator connected.
                'fleet' => (string) $row->tenant_id,
                'submission' => $row->uuid,
                // Which of its two tables it is about. Named, never defaulted:
                // a Beleg ingested as a note loses its photo and its amount.
                'subject' => $row->subject,
            ]);

        // 429 is their rate limit and the catch-up is the recovery, so it is not
        // worth a retry storm; anything else that failed is logged once at
        // debug level, because the submission is still pending and visible.
        if ($response->failed() && $response->status() !== 429) {
            Log::debug('elprofessor ring not accepted', [
                'submission' => $row->uuid,
                'status' => $response->status(),
            ]);
        }
    }
}
