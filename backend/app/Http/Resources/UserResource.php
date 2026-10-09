<?php

namespace App\Http\Resources;

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
            ] : null,
            'roles' => $this->getRoleNames(),
            'permissions' => $this->getAllPermissions()->pluck('name')->values(),
        ];
    }
}
