<?php

namespace App\Domain\Receipts;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Where an async receipt read lives between upload and result.
 *
 * Status is a short-lived cache entry keyed by driver AND job id (so a driver
 * can only ever poll their own); the uploaded image sits in a private temp
 * file only until the job has parsed it, and any orphan (worker down) is swept
 * after {@see ORPHAN_MINUTES}. Nothing here is a record: it all expires.
 */
class ReceiptVisionJobs
{
    private const TTL_MINUTES = 15;

    private const ORPHAN_MINUTES = 30;

    private const DIR = 'receipt-vision-tmp';

    /** Park the upload and mark the read pending; returns the job id. */
    public function begin(int $driverId, string $imageBytes): string
    {
        $this->sweepOrphans();
        $id = (string) Str::uuid();
        Storage::disk('local')->put($this->path($id), $imageBytes);
        $this->put($driverId, $id, ['status' => 'pending']);

        return $id;
    }

    /** @return array{status: string, fields?: array<string, mixed>}|null null = unknown/expired */
    public function status(int $driverId, string $id): ?array
    {
        return Cache::get($this->key($driverId, $id));
    }

    /** @param  array<string, mixed>  $fields */
    public function done(int $driverId, string $id, array $fields): void
    {
        $this->put($driverId, $id, ['status' => 'done', 'fields' => $fields]);
    }

    public function failed(int $driverId, string $id): void
    {
        $this->put($driverId, $id, ['status' => 'failed']);
    }

    public function image(string $id): ?string
    {
        $disk = Storage::disk('local');

        return $disk->exists($this->path($id)) ? $disk->get($this->path($id)) : null;
    }

    /** The photo is deleted the moment it has been parsed (or has failed to be). */
    public function discard(string $id): void
    {
        Storage::disk('local')->delete($this->path($id));
    }

    /** First caller wins; a re-released queue job must not run inference twice. */
    public function claim(string $id): bool
    {
        return Cache::add("receipt-vision:claim:{$id}", 1, now()->addMinutes(self::TTL_MINUTES));
    }

    private function sweepOrphans(): void
    {
        $disk = Storage::disk('local');
        $cutoff = now()->subMinutes(self::ORPHAN_MINUTES)->getTimestamp();
        foreach ($disk->files(self::DIR) as $file) {
            if ($disk->lastModified($file) < $cutoff) {
                $disk->delete($file);
            }
        }
    }

    /** @param  array<string, mixed>  $state */
    private function put(int $driverId, string $id, array $state): void
    {
        Cache::put($this->key($driverId, $id), $state, now()->addMinutes(self::TTL_MINUTES));
    }

    private function key(int $driverId, string $id): string
    {
        return "receipt-vision:{$driverId}:{$id}";
    }

    private function path(string $id): string
    {
        return self::DIR."/{$id}.bin";
    }
}
