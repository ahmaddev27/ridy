<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DispatchOfferResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'offer_uuid' => $this->offer_uuid,
            'driver_uuid' => $this->driver_uuid,
            'driver_id' => $this->driver_id,
            'driver_name' => $this->driver?->name
                ?? trim(($this->driver_first_name ?? '').' '.($this->driver_last_name ?? '')) ?: null,
            'linked' => $this->driver_id !== null,
            'status' => $this->status?->value,
            'accepted' => $this->accepted_at !== null,
            'accepted_at' => $this->accepted_at?->toIso8601String(),
            'started_at' => $this->started_at?->toIso8601String(),
            'completed_at' => $this->completed_at?->toIso8601String(),
            'rejected_at' => $this->rejected_at?->toIso8601String(),
            'canceled_at' => $this->canceled_at?->toIso8601String(),
            'rider_first_name' => $this->rider_first_name,
            'pickup_address' => $this->pickup_address,
            'dropoff_address' => $this->dropoff_address,
            'fare_formatted' => $this->fare_formatted,
            'accept_window_seconds' => $this->accept_window_seconds,
            'received_at' => $this->received_at?->toIso8601String(),
        ];
    }
}
