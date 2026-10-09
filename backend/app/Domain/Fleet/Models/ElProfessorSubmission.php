<?php

namespace App\Domain\Fleet\Models;

use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * One thing a driver submitted for their company to review in El-Professor: a
 * note, or a receipt with its photo.
 *
 * El-Professor fetches these; it is not sent them. The reason is a measurement
 * rather than a preference — Sanctum stores only a hash, so this side cannot
 * replay the token it issued, and El-Professor's intake authenticates with
 * exactly that token. So this side **rings** and El-Professor pulls with the
 * token it holds sealed (owner's decision, 08.10.2026).
 *
 * `uuid` is the id that travels; `id` stays for this side's own joins. The two
 * read endpoints and the ring all address a submission by its uuid.
 */
class ElProfessorSubmission extends Model
{
    use BelongsToTenant;

    /** Waiting for El-Professor to fetch it. */
    public const STATUS_PENDING = 'pending';

    /** Fetched, so a catch-up does not offer it again. */
    public const STATUS_TAKEN = 'taken';

    /** What the company decided, which arrives at the status endpoint. */
    public const STATUS_ACCEPTED = 'accepted';

    public const STATUS_REJECTED = 'rejected';

    /** The two subjects. An allow-list, because `subject` decides which of two
     *  tables El-Professor writes and a value it does not know is dropped. */
    public const SUBJECTS = ['note', 'receipt'];

    protected $table = 'elprofessor_submissions';

    protected $fillable = [
        'tenant_id', 'driver_id', 'uuid', 'subject', 'status', 'payload',
        'document_path', 'document_mime', 'document_bytes',
        'fetched_at', 'decided_at', 'decision_code', 'decision_text',
    ];

    protected $casts = [
        'payload' => 'array',
        'document_bytes' => 'integer',
        'fetched_at' => 'datetime',
        'decided_at' => 'datetime',
    ];

    public static function booted(): void
    {
        // The id that travels is filled here, never by a caller: a submission
        // whose uuid came from the request would let one driver address another
        // driver's submission by choosing its id.
        static::creating(function (self $row) {
            if (empty($row->uuid)) {
                $row->uuid = (string) Str::uuid();
            }
        });
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /**
     * Still waiting to be fetched. A decided submission is never pending again,
     * so a catch-up cannot re-ingest a receipt the company already judged.
     */
    public function isPending(): bool
    {
        return $this->status === self::STATUS_PENDING;
    }
}
