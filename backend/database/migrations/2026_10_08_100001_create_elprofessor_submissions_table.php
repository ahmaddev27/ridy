<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What a driver submits for their company to review in El-Professor: a note, or
 * a receipt with its photo.
 *
 * ## Why this side keeps a table at all
 *
 * It did not, by design, until 08.10.2026. The status endpoint's own header says
 * so: "the submission id belongs to El-Professor; this side has no table of
 * submissions and does not need one." That was true while El-Professor was to be
 * PUSHED the payload.
 *
 * It stopped being true on a measurement: **Sanctum stores only a hash, so this
 * side cannot replay the token it issued** — and El-Professor's intake
 * authenticates with exactly that token. So the direction was turned around by
 * the owner's decision of the same day: we **ring** (four fields, no payload, no
 * credential) and El-Professor fetches the submission from here with the token it
 * holds sealed. A fetch needs something to fetch, which is this table.
 *
 * ## `uuid` is the id that travels
 *
 * El-Professor stores it as `external_submission_id` and it is the key of its
 * idempotency, so it must be stable for ever and must not be an auto-increment
 * that leaks how many submissions every fleet has made. The bigint `id` stays
 * for this side's own joins, as everywhere else in this schema.
 *
 * ## The photo is a file on a disk, not a column
 *
 * `document_path` is a path on the `local` disk under `elprofessor/<tenant>/`.
 * A column would put a phone photo in every row of every query that forgets to
 * exclude it, and this table is read by a list endpoint.
 *
 * ## Status, and what the fourth one is for
 *
 * `pending` is waiting for El-Professor to fetch it; `taken` is fetched, so a
 * catch-up does not offer it again; `rejected` and `accepted` are what the
 * company decided, which arrives at `POST elprofessor/submissions/status`. A
 * submission is never deleted here: the driver's app shows them their own
 * history, and a rejection they can no longer see is a rejection they cannot act
 * on.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('elprofessor_submissions', function (Blueprint $table) {
            $table->id();
            // The id that travels. Stable for ever, and not an auto-increment:
            // El-Professor keys its idempotency on it, and a sequence would tell
            // every fleet how many submissions every other fleet has made.
            $table->uuid('uuid')->unique();
            $table->unsignedBigInteger('tenant_id')->index();
            $table->unsignedBigInteger('driver_id')->index();

            // 'note' or 'receipt'. A string and not an enum, because adding a
            // third subject must not be a schema change on a live database.
            $table->string('subject', 16);
            $table->string('status', 16)->default('pending');

            // What the driver typed, verbatim. El-Professor validates every
            // field of it again on arrival — its `receipts` row moves money —
            // so this is the submission and not a reading of it.
            $table->json('payload');

            // The photo. Path on the local disk; the bytes are never a column.
            $table->string('document_path')->nullable();
            $table->string('document_mime', 64)->nullable();
            $table->unsignedInteger('document_bytes')->nullable();

            // When El-Professor fetched it, and when a person there decided.
            $table->timestamp('fetched_at')->nullable();
            $table->timestamp('decided_at')->nullable();
            $table->string('decision_code', 64)->nullable();
            $table->text('decision_text')->nullable();

            $table->timestamps();

            // The list endpoint's only query: this tenant's pending submissions,
            // oldest first, because the oldest is the one somebody is waiting on.
            $table->index(['tenant_id', 'status', 'created_at'], 'elprof_sub_tenant_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('elprofessor_submissions');
    }
};
