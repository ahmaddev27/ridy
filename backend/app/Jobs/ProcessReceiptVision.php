<?php

namespace App\Jobs;

use App\Domain\Receipts\ReceiptVision;
use App\Domain\Receipts\ReceiptVisionJobs;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Read one uploaded receipt with the vision model, off the request path.
 *
 * CPU inference takes 30-90 s, so the driver never waits on it: the upload
 * was acked, this runs on the `default` queue, and the app polls the result.
 * One attempt only - a failed read is reported as `failed` and the app simply
 * keeps its on-device result. The photo is deleted in `finally`, success or not.
 */
class ProcessReceiptVision implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    /** Above the model's HTTP timeout; the worker's default 60 s would cut it short. */
    public int $timeout = 270;

    public function __construct(public readonly int $driverId, public readonly string $jobId) {}

    public function handle(ReceiptVision $vision, ReceiptVisionJobs $jobs): void
    {
        if (! $jobs->claim($this->jobId)) {
            return;
        }
        try {
            $bytes = $jobs->image($this->jobId);
            $fields = $bytes === null ? null : $vision->read($bytes);
            $fields === null ? $jobs->failed($this->driverId, $this->jobId) : $jobs->done($this->driverId, $this->jobId, $fields);
        } catch (Throwable $e) {
            Log::warning('receipt-vision.failed', ['driver' => $this->driverId, 'error' => $e->getMessage()]);
            $jobs->failed($this->driverId, $this->jobId);
        } finally {
            $jobs->discard($this->jobId);
        }
    }

    /** A timeout kills the worker's child before `finally`; settle the state here. */
    public function failed(Throwable $e): void
    {
        $jobs = app(ReceiptVisionJobs::class);
        if (($jobs->status($this->driverId, $this->jobId)['status'] ?? null) === 'pending') {
            $jobs->failed($this->driverId, $this->jobId);
        }
        $jobs->discard($this->jobId);
    }
}
