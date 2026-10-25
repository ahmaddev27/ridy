<?php

namespace App\Console\Commands;

use App\Domain\Fleet\Models\ElProfessorSubmission;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Drop the stored photo of a submission once El-Professor has had it for a while.
 *
 * The photo exists to be FETCHED by El-Professor (the app shows no image). Once
 * `fetched_at` is older than `elprofessor.photo_retention_minutes` the file is
 * deleted from the disk and `document_path` is nulled. The row, the payload and
 * `document_bytes` stay for ever: the driver's archive and its numbers survive,
 * only the image goes.
 *
 * `fetched_at` is written once, at the FIRST fetch, so a re-fetch does not extend
 * the window. The cost: a transfer cut mid-way can be retried only until the
 * window closes. Raise the window in config, not here.
 *
 * Not `BatchDelete::run()`: that helper DELETES rows, and this must keep them. It
 * is the same short, id-bounded batching, done with chunkById. A missing file is
 * not an error and one failing row never aborts the run.
 */
class PruneSubmissionPhotos extends Command
{
    protected $signature = 'elprofessor:prune-photos';

    protected $description = 'Delete submission photos El-Professor fetched more than the retention window ago.';

    public function handle(): int
    {
        $minutes = (int) config('elprofessor.photo_retention_minutes', 120);
        $disk = Storage::disk(config('elprofessor.disk', 'local'));
        $pruned = 0;
        $failed = 0;

        ElProfessorSubmission::query()
            ->withoutGlobalScopes()
            ->whereNotNull('document_path')
            ->whereNotNull('fetched_at')
            ->where('fetched_at', '<', now()->subMinutes($minutes))
            ->chunkById(500, function ($rows) use ($disk, &$pruned, &$failed) {
                foreach ($rows as $row) {
                    try {
                        $disk->delete($row->document_path);
                        $row->forceFill(['document_path' => null])->saveQuietly();
                        $pruned++;
                    } catch (Throwable $e) {
                        $failed++;
                        report($e);
                    }
                }
            });

        $this->info("Pruned {$pruned} photo(s), {$failed} failed.");

        return self::SUCCESS;
    }
}
