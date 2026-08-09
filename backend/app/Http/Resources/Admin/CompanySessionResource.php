<?php

namespace App\Http\Resources\Admin;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A company's Uber fleet session for the super-admin — explicitly whitelisted so
 * the encrypted `cookies` are never serialized.
 */
class CompanySessionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'uber_org_uuid' => $this->uber_org_uuid,
            'status' => $this->status,
            'expires_at' => $this->expires_at?->toIso8601String(),
            'last_event_at' => $this->last_event_at?->toIso8601String(),
        ];
    }
}
