<?php

namespace App\Http\Resources\Admin;

use App\Domain\Dispatch\Models\SessionBrowser;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin SessionBrowser */
class SessionBrowserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'state' => $this->state,
            'last_login_at' => $this->last_login_at?->toIso8601String(),
            'last_capture_at' => $this->last_capture_at?->toIso8601String(),
            'last_seen_at' => $this->last_seen_at?->toIso8601String(),
            'hard_reauth_count' => $this->hard_reauth_count,
            'consecutive_errors' => $this->consecutive_errors,
            'is_live' => $this->isLive(),
        ];
    }
}
