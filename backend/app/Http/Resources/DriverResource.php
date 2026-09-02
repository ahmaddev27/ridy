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
            // Set when a full Uber roster sync no longer listed this driver — they
            // were dropped from the supplier fleet but kept on our side.
            'roster_removed_at' => $this->roster_removed_at?->toIso8601String(),
            'online' => $this->isOnline(),
            'online_status' => $this->online_status,
            'location_updated_at' => $this->location_updated_at?->toIso8601String(),
            'email' => $this->email,
            'app_status' => $this->appStatus(),
            // Human label of the driver's most-recent app device (model + OS),
            // e.g. "Pixel 7 · Android 14"; null until a build that reports it registers.
            'device_label' => $this->latestDeviceToken?->label(),
        ];
    }
}
