<?php

namespace App\Http\Resources\Admin;

use App\Http\Resources\UserResource;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A company (tenant) as seen by the super-admin. The `proxy_url` holds proxy
 * credentials, so the list only ever exposes a masked form; the real value is
 * returned only in detail mode (for the edit form). Per-company stats
 * (driver/offer counts, session) are attached as dynamic attributes by the
 * controller to avoid N+1.
 */
class CompanyResource extends JsonResource
{
    public bool $detailed = false;

    public static function detail(mixed $resource): self
    {
        $r = new self($resource);
        $r->detailed = true;

        return $r;
    }

    public function toArray(Request $request): array
    {
        $proxy = $this->getAttribute('proxy_url');
        $session = $this->getAttribute('session_info');

        return [
            'id' => $this->id,
            'name' => $this->name,
            'country' => $this->country,
            'status' => $this->status,
            'uber_org_uuid' => $this->uber_org_uuid,

            // Proxy — masked in list, real only in detail (never leaks creds in a list).
            'has_proxy' => filled($proxy),
            'proxy_url_masked' => $this->maskProxy($proxy),
            'proxy_url' => $this->detailed ? $proxy : null,

            // Stats (attached by the controller).
            'driver_count' => (int) ($this->getAttribute('driver_count') ?? 0),
            'offer_count' => (int) ($this->getAttribute('offer_count') ?? 0),
            'email_verified' => (bool) $this->getAttribute('email_verified'),
            'session_status' => $session['status'] ?? null,
            'session_last_event_at' => $session['last_event_at'] ?? null,
            'session_expires_at' => $session['expires_at'] ?? null,

            'users' => $this->detailed
                ? UserResource::collection($this->getAttribute('users_list') ?? collect())
                : null,
        ];
    }

    /** Redact the userinfo (user:pass@) so a masked proxy never exposes creds. */
    private function maskProxy(?string $url): ?string
    {
        if (! $url) {
            return null;
        }

        return preg_replace('#//[^@/]*@#', '//••••@', $url);
    }
}
