<?php

namespace App\Domain\Notifications;

use App\Domain\Dispatch\AddressFormatter;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;
use App\Events\OfferBroadcast;

/**
 * Turns a routed dispatch offer into a push to every device of its linked driver.
 *
 * The message is deliberately data-only (no translated words) so it reads the
 * same in every language and every value stays Latin:
 *
 *   Title:  "5.85 €€ | Peter"     (fare, €-quality by price/km, rider name)
 *   Body:   "Birkerstraße 55, 42651 Solingen
 *            -->
 *            Eintrachtstraße 50, 42655 Solingen"
 *
 * The €-signs encode the per-km rate at a glance: 1 up to €1/km, 2 above €1,
 * 3 at €3/km or more. Addresses drop the country and keep street + postcode + city.
 */
class DispatchNotifier
{
    public function __construct(private PushSender $sender) {}

    /**
     * @return int number of devices the offer was pushed to
     */
    public function notify(DispatchOffer $offer): int
    {
        if ($offer->driver_id === null) {
            return 0; // unlinked offers have no one to notify
        }

        // Real-time nudge to the driver's open app (WebSocket) so a fresh offer
        // appears instantly, alongside the push that wakes a closed app. Best
        // -effort: a broadcast failure (Reverb down) must never break ingestion.
        rescue(fn () => broadcast(new OfferBroadcast((int) $offer->driver_id, (int) $offer->id, 'new')), report: false);

        $title = $this->buildTitle($offer);
        $body = $this->buildBody($offer);
        $data = [
            // Ties the push to the app's "offer" notification category so the
            // "Open in map" action button is rendered (see FcmPushSender::message).
            'categoryId' => 'offer',
            'offer_id' => (string) $offer->id,
            'offer_uuid' => (string) $offer->offer_uuid,
            'pickup' => $this->cleanAddress($offer->pickup_address),
            'dropoff' => $this->cleanAddress($offer->dropoff_address),
            'fare' => (string) ($offer->fare_formatted ?? ''),
            'fare_amount' => (string) ($offer->fare_amount ?? ''),
            'distance_m' => (string) ($offer->distance_m ?? ''),
            'accept_window' => (string) ($offer->accept_window_seconds ?? ''),
            'received_at' => optional($offer->received_at)->toIso8601String() ?? '',
        ];

        $tokens = DeviceToken::where('driver_id', $offer->driver_id)->get();

        $sent = 0;
        foreach ($tokens as $token) {
            if ($this->sender->send($token->token, $title, $body, $data)) {
                $sent++;
            }
        }

        $sent += $this->notifyOwners($offer, $title, $body, $data);

        return $sent;
    }

    /**
     * Fan the same offer out to the tenant's fleet owners/managers who registered
     * a device in owner mode. The driver still gets their own push unchanged; the
     * owner's copy carries the driver name so they know whose offer it is.
     *
     * @param  array<string, string>  $data
     * @return int number of owner devices notified
     */
    private function notifyOwners(DispatchOffer $offer, string $title, string $body, array $data): int
    {
        // Scope explicitly by the offer's tenant (bypass the global scope): owner
        // tokens are the tenant's, keyed by user_id, never a driver.
        $tokens = DeviceToken::withoutGlobalScopes()
            ->where('tenant_id', $offer->tenant_id)
            ->whereNotNull('user_id')
            ->get();

        if ($tokens->isEmpty()) {
            return 0;
        }

        // Fleet-manager layout (4 lines): numbers on the title, then driver · rider,
        // then pickup, then drop-off — so the manager reads whose offer it is at a
        // glance. (The driver's own push keeps the rider on the title line.)
        $ownerTitle = $this->buildNumbers($offer);
        $driverName = $this->driverName($offer);
        $rider = trim((string) $offer->rider_first_name);
        $names = trim($driverName.($rider !== '' ? ' · '.$rider : ''));
        $ownerBody = $names !== '' ? trim($names."\n".$body) : $body;

        $sent = 0;
        foreach ($tokens as $token) {
            if ($this->sender->send($token->token, $ownerTitle, $ownerBody, $data)) {
                $sent++;
            }
        }

        return $sent;
    }

    /** The offer's driver name, from the linked driver or the captured payload. */
    private function driverName(DispatchOffer $offer): string
    {
        $name = $offer->driver?->name
            ?? trim(($offer->driver_first_name ?? '').' '.($offer->driver_last_name ?? ''));

        return trim((string) $name);
    }

    /** "5.85 €€ · 12.3 km · €1.26/km" — fare, €-quality and trip metrics, no names. */
    private function buildNumbers(DispatchOffer $offer): string
    {
        $fare = $offer->fare_amount !== null
            ? number_format((float) $offer->fare_amount, 2, '.', '')
            : trim((string) $offer->fare_formatted);

        $numbers = trim($fare.' '.$this->euroSigns($offer));

        // Distance + price-per-km ride on the first line, beside the fare.
        $metrics = $this->buildMetrics($offer);
        if ($metrics !== '') {
            $numbers .= ' · '.$metrics;
        }

        return $numbers;
    }

    /** "5.85 €€ · 12.3 km · €1.26/km | Peter" — the driver's title (numbers + rider). */
    private function buildTitle(DispatchOffer $offer): string
    {
        $numbers = $this->buildNumbers($offer);
        $rider = trim((string) $offer->rider_first_name);

        return $rider !== '' ? $numbers.' | '.$rider : $numbers;
    }

    /**
     * Alert the DRIVER that Uber revealed more than one drop-off on their accepted
     * trip, and broadcast so the open app refreshes the offer detail live with the
     * new stops / distance / €-per-km. Word-free like the offer push (the app
     * localises it from `stops_count`); best-effort, never breaks ingestion.
     *
     * @return int devices pushed
     */
    public function notifyMultiStop(DispatchOffer $offer, int $stopsCount): int
    {
        if ($offer->driver_id === null) {
            return 0;
        }

        // Live nudge to the open app so it re-fetches the offer with the new stops.
        rescue(fn () => broadcast(new OfferBroadcast((int) $offer->driver_id, (int) $offer->id, 'multistop')), report: false);

        // Lead the title with a bold, language-neutral multi-stop mark ("📍×N") so
        // the driver spots the extra drop-offs at a glance — the pin-with-count reads
        // the same in every language, unlike the subtle "⚑" that trailed before.
        $mark = '📍×'.$stopsCount;
        $title = trim($mark.' · '.$this->buildNumbers($offer));
        // Body opens with the same mark, then the addresses + metrics, so the alert
        // still signals multi-stop even when only the body is visible (lock screen).
        $metrics = $this->buildMetrics($offer);
        $body = trim($mark.'  '.$this->buildBody($offer).($metrics !== '' ? "\n".$metrics : ''));

        $data = [
            'categoryId' => 'offer',
            'offer_id' => (string) $offer->id,
            'offer_uuid' => (string) $offer->offer_uuid,
            'stops_count' => (string) $stopsCount,
            'distance_m' => (string) ($offer->distance_m ?? ''),
            'fare_amount' => (string) ($offer->fare_amount ?? ''),
            'pickup' => $this->cleanAddress($offer->pickup_display ?? $offer->pickup_address),
            'dropoff' => $this->cleanAddress($offer->dropoff_display ?? $offer->dropoff_address),
        ];

        $sent = 0;
        foreach (DeviceToken::where('driver_id', $offer->driver_id)->get() as $token) {
            if ($this->sender->send($token->token, $title, $body, $data)) {
                $sent++;
            }
        }

        return $sent;
    }

    /** "pickup\ndropoff" — the two addresses, country stripped, no separator arrow. */
    private function buildBody(DispatchOffer $offer): string
    {
        $pickup = $this->cleanAddress($offer->pickup_address);
        $dropoff = $this->cleanAddress($offer->dropoff_address);

        $lines = array_values(array_filter([$pickup, $dropoff], fn ($l) => $l !== ''));

        return $lines === [] ? 'Uber' : implode("\n", $lines);
    }

    /** "12.3 km · €1.26/km" so the driver can judge worth — empty when distance is unknown. */
    private function buildMetrics(DispatchOffer $offer): string
    {
        if (! $offer->distance_m) {
            return '';
        }

        $km = $offer->distance_m / 1000;
        $parts = [number_format($km, 1, '.', '').' km'];

        $fare = (float) ($offer->fare_amount ?? 0);
        if ($fare > 0 && $km > 0) {
            $parts[] = '€'.number_format($fare / $km, 2, '.', '').'/km';
        }

        return implode(' · ', $parts);
    }

    /** €/€€/€€€ by the trip's per-km rate. Falls back to one sign when unknown. */
    private function euroSigns(DispatchOffer $offer): string
    {
        $fare = (float) ($offer->fare_amount ?? 0);
        $km = $offer->distance_m ? $offer->distance_m / 1000 : 0.0;
        if ($fare <= 0 || $km <= 0) {
            return '€';
        }

        $perKm = $fare / $km;

        return match (true) {
            $perKm >= 3 => '€€€',
            $perKm > 1 => '€€',
            default => '€',
        };
    }

    /** Canonical "Street No, PLZ City" for the push — same formatter as everywhere. */
    private function cleanAddress(?string $address): string
    {
        return AddressFormatter::tidy($address) ?? '';
    }
}
