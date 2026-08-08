<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DriverResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'pseudonym' => $this->pseudonym_id,
            'phone' => $this->phone,
            'uber_driver_uuid' => $this->uber_driver_uuid,
            'uber_email' => $this->uber_email,
            'uber_link_method' => $this->uber_link_method,
            'uber_linked' => $this->uber_driver_uuid !== null,
            'picture_url' => $this->uber_picture_url,
            'rating' => $this->uber_rating !== null ? (float) $this->uber_rating : null,
            'total_trips' => $this->uber_total_trips,
            'status' => $this->uber_status,
            'active' => $this->uber_status === 'ONBOARDING_STATUS_ACTIVE',
        ];
    }
}
