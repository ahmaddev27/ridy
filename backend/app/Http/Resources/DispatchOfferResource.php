<?php

namespace App\Http\Resources;

use App\Domain\Dispatch\AddressLatinizer;
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
            'pickup_address' => $this->latinAddress($this->pickup_display, Arr::get($this->raw_payload, 'pickupAddress') ?: $this->pickup_address),
            'dropoff_address' => $this->latinAddress($this->dropoff_display, Arr::get($this->raw_payload, 'dropoffAddress') ?: $this->dropoff_address),
            'pickup_station_name' => $this->pickup_station_name,
            'dropoff_station_name' => $this->dropoff_station_name,
            'fare_formatted' => $this->fare_formatted,
            'fare_amount' => $this->fare_amount !== null ? (float) $this->fare_amount : null,
            // Road distance once the trip is geocoded — lets the driver app show
            // the distance and derive €/km (same data the dashboard trip view uses).
            'distance_m' => $this->distance_m,
            // Resolved coordinates so the app can open the maps route BY COORDINATE
            // instead of re-geocoding a house-number-less address text (wrong pin).
            'pickup_lat' => $this->pickup_lat !== null ? (float) $this->pickup_lat : null,
            'pickup_lng' => $this->pickup_lng !== null ? (float) $this->pickup_lng : null,
            'dropoff_lat' => $this->dropoff_lat !== null ? (float) $this->dropoff_lat : null,
            'dropoff_lng' => $this->dropoff_lng !== null ? (float) $this->dropoff_lng : null,
            // 'uber' = the coordinates are Uber's exact live-map waypoints (post-accept),
            // so the app pins by coordinate; otherwise it lets the maps app geocode the text.
            'geo_source' => $this->geo_source,
            // Number of drop-offs once resolved from Uber's live map (>= 2 = multi-
            // stop). Lets the offers list badge a multi-stop trip without the detail.
            'stops_count' => $this->stops_count,
            // Ordered stops (pickup first, then each drop-off), each with its address
            // and the road distance from the previous stop — so the driver app can
            // list a multi-stop trip's drop-offs with per-leg km. Null until resolved.
            // Each stop's address is Latinized too, so the itinerary in the detail view
            // never shows the rider-localized (e.g. Japanese) text the list already hides.
            'stops' => $this->latinStops(),
            'accept_window_seconds' => $this->accept_window_seconds,
            'received_at' => $this->received_at?->toIso8601String(),
        ];
    }

    /**
     * The address to expose, guaranteed Latin. The stored *_display is preferred,
     * else the supplier's tidied raw text. Uber localizes that raw text to the
     * RIDER's app language, so an offer seen before geocoding can still carry an
     * unreadable non-Latin string ("ドイツ 〒42781 ハーン グルイテン"); replace it with the
     * authoritative German "<PLZ> City" from the always-Latin postcode inside it,
     * or blank when it has none — a driver must never be shown a foreign address.
     */
    private function latinAddress(?string $display, mixed $raw): ?string
    {
        return AddressLatinizer::toLatin($display, $raw);
    }

    /**
     * The stops itinerary with every address Latinized the same way as the endpoint
     * addresses, so the detail view / driver app never render a rider-localized
     * (non-Latin) stop label while the list shows the clean German one.
     *
     * @return array<int, array<string, mixed>>|null
     */
    private function latinStops(): ?array
    {
        if (! is_array($this->stops)) {
            return null;
        }

        return array_map(function ($stop) {
            if (is_array($stop) && array_key_exists('address', $stop)) {
                $stop['address'] = $this->latinAddress(is_string($stop['address']) ? $stop['address'] : null, null);
            }

            return $stop;
        }, $this->stops);
    }
}
