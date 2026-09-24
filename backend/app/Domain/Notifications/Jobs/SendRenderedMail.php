<?php

namespace App\Domain\Notifications\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Delivers an already-rendered email on the queue.
 *
 * Mail used to go out inline on the request path: a slow SMTP host stalled the
 * daemon's internal calls and FPM workers, and the SMTP round-trip made "unknown
 * email" and "known email" answers of the OTP endpoints distinguishable by timing.
 * The message is rendered BEFORE queueing so the job carries plain strings only.
 */
class SendRenderedMail implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** @var array<int, int> */
    public array $backoff = [10, 60];

    public int $timeout = 60;

    /**
     * @param  string|array<int, string>  $to
     */
    public function __construct(
        public readonly string|array $to,
        public readonly string $subject,
        public readonly string $body,
        public readonly bool $html = true,
    ) {}

    public function handle(): void
    {
        $build = function ($message) {
            $message->to($this->to)->subject($this->subject);
        };

        $this->html ? Mail::html($this->body, $build) : Mail::raw($this->body, $build);
    }

    public function failed(?Throwable $e): void
    {
        // Recipients stay out of the log — the subject and error identify the mail.
        Log::warning('mail.send_failed', ['subject' => $this->subject, 'error' => $e?->getMessage()]);
    }
}
