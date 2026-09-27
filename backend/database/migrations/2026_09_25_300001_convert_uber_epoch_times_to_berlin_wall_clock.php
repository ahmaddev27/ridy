<?php

use App\Domain\Dispatch\EpochTimeBackfill;
use Illuminate\Database\Migrations\Migration;

/**
 * Uber's epoch-millisecond times were stored as UTC wall-clock time (Carbon's
 * createFromTimestampMs() is UTC and Eloquent doesn't convert zones) while every
 * other column holds Europe/Berlin wall-clock time — 1-2 h behind. The code now
 * converts through App\Support\EpochTime; this shifts the rows written before.
 *
 * The work (idempotent, resumable, safe against rows old and new code write
 * during the deploy) lives in {@see EpochTimeBackfill}, which
 * `dispatch:convert-epoch-times` also runs after a rolled-back deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        app(EpochTimeBackfill::class)->run();
    }

    public function down(): void
    {
        // Data correction — nothing to undo (the old values were wrong).
    }
};
