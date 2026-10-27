<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A passkey as the management UI sees it. Never the public key, never the user
 * handle — the id is opaque to the client and only ever echoed back.
 */
class WebauthnCredentialResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'alias' => $this->alias,
            'created_at' => $this->created_at,
            'last_used_at' => $this->last_used_at,
        ];
    }
}
