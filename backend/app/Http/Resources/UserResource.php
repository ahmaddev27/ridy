<?php

namespace App\Http\Resources;

use App\Domain\Dispatch\PasswordlessLoginService;
use App\Domain\Dispatch\PasswordlessLoginSettings;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'tenant' => $this->tenant ? [
                'id' => $this->tenant->id,
                'name' => $this->tenant->name,
                // The platform's per-company switch for the El-Professor link.
                // The sidebar hides the page on it, so it travels with the
                // session rather than costing a request on every render.
                'elprofessor_enabled' => $this->tenant->elprofessorEnabled(),
                // Dispatch-reject is the ONE switch behind both the manual decline
                // and auto-decline ("Early decline"): the sidebar hides the
                // Early-decline page unless it is on, so it travels with the session.
                'dispatch_reject_enabled' => $this->tenant->dispatchRejectEnabled(),
                // Passwordless Uber login (docs/27): the Connect page is hidden unless
                // the global switch, the allowlist and the company flag all allow it.
                'passwordless_login_enabled' => app(PasswordlessLoginSettings::class)->availableFor($this->tenant),
                // A never-connected company can connect cold (email + code) only when the cold flag is on.
                'cobrowse_enabled' => app(PasswordlessLoginSettings::class)->cobrowseEnabledFor($this->tenant),
                'passwordless_primary' => app(PasswordlessLoginService::class)->codeLoginIsPrimary($this->tenant),
                'cold_connect_available' => app(PasswordlessLoginService::class)->coldConnectAvailable($this->tenant),
                // The cold connect is a full co-browse login: the human signs in inside the stream, no email asked.
                'full_cobrowse_available' => app(PasswordlessLoginService::class)->fullCobrowseAvailable($this->tenant),
                // Migrated off the browser extension (docs/30): the dashboard reads Uber data
                // server-side and connects via co-browse. The frontend gates the extension off on this.
                'extension_retired' => $this->tenant->onNewSystem(),
            ] : null,
            'roles' => $this->getRoleNames(),
            'permissions' => $this->getAllPermissions()->pluck('name')->values(),
        ];
    }
}
