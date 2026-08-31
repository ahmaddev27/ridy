<?php

namespace App\Http\Resources;

use App\Domain\Dispatch\AddressFormatter;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Arr;

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
            'status' => $this->displayStatus()->value,
            'accepted' => $this->accepted_at !== null,
            'accepted_at' => $this->accepted_at?->toIso8601String(),
            'started_at' => $this->started_at?->toIso8601String(),
            'completed_at' => $this->completed_at?->toIso8601String(),
            // How long the trip actually took (start -> completion), in seconds.
            'trip_duration_seconds' => $this->started_at !== null && $this->completed_at !== null
                ? (int) $this->started_at->diffInSeconds($this->completed_at)
                : null,
            'rejected_at' => $this->rejected_at?->toIso8601String(),
            'canceled_at' => $this->canceled_at?->toIso8601String(),
            'rider_first_name' => $this->rider_first_name,
            // Alias the driver app reads as the customer/rider name.
            'rider_name' => $this->rider_first_name,
            // Always show the supplier's ORIGINAL address, sourced from the raw
            // payload — identical in the list and the detail modal, and immune to
            // any legacy geocoder rewrite still stored on the columns.
            'pickup_address' => $this->pickup_display ?? AddressFormatter::tidy(Arr::get($this->raw_payload, 'pickupAddress') ?: $this->pickup_address),
            'dropoff_address' => $this->dropoff_display ?? AddressFormatter::tidy(Arr::get($this->raw_payload, 'dropoffAddress') ?: $this->dropoff_address),
            'pickup_station_name' => $this->pickup_station_name,
            'dropoff_station_name' => $this->dropoff_station_name,
            'fare_formatted' => $this->fare_formatted,
            'fare_amount' => $this->fare_amount !== null ? (float) $this->fare_amount : null,
            // Road distance once the trip is geocoded — lets the driver app show
            // the distance and derive €/km (same data the dashboard trip view uses).
            'distance_m' => $this->distance_m,
            // Number of drop-offs once resolved from Uber's live map (>= 2 = multi-
            // stop). Lets the offers list badge a multi-stop trip without the detail.
            'stops_count' => $this->stops_count,
            'accept_window_seconds' => $this->accept_window_seconds,
            'received_at' => $this->received_at?->toIso8601String(),
        ];
    }
}
