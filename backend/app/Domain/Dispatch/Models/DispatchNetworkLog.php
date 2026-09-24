<?php

namespace App\Domain\Dispatch\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One captured inbound dispatch request (offer batch, driver-status batch, or
 * roster pull). Append-only; read by the admin Network tab, pruned by retention.
 *
 * @property int $tenant_id
 * @property string $kind
 * @property string|null $offer_uuid
 * @property string|null $summary
 * @property int|null $count
 * @property array $payload
 */
class DispatchNetworkLog extends Model
{
    /** Largest payload stored as-is (bytes of JSON). */
    public const MAX_PAYLOAD_BYTES = 262144;

    public const UPDATED_AT = null; // append-only — created_at only

    protected $guarded = [];

    protected $casts = [
        'payload' => 'array',
        'count' => 'integer',
    ];

    /**
     * Record an inbound request. Best-effort: logging must never break ingestion,
     * so callers wrap this and swallow failures.
     */
    public static function record(?int $tenantId, string $kind, mixed $payload, ?string $summary = null, ?int $count = null, ?string $offerUuid = null): void
    {
        // A debug feed, not an archive: an oversized capture is replaced by a
        // marker instead of bloating the table and the admin Network responses.
        $bytes = strlen((string) json_encode($payload));
        if ($bytes > self::MAX_PAYLOAD_BYTES) {
            $payload = ['truncated' => true, 'bytes' => $bytes];
        }

        self::create([
            'tenant_id' => $tenantId,
            'kind' => $kind,
            'offer_uuid' => $offerUuid !== null && $offerUuid !== '' ? mb_substr($offerUuid, 0, 64) : null,
            'summary' => $summary !== null ? mb_substr($summary, 0, 250) : null,
            'count' => $count,
            'payload' => $payload,
            'created_at' => now(),
        ]);
    }
}
