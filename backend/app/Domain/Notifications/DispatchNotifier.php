<?php

namespace App\Domain\Notifications;

use App\Domain\Dispatch\AddressFormatter;
use App\Domain\Dispatch\AddressLatinizer;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Contracts\SendsPushInBulk;
use App\Domain\Notifications\Jobs\NotifyOwnersOfOffer;
use App\Domain\Notifications\Models\DeviceToken;
use App\Events\OfferBroadcast;
use Illuminate\Support\Facades\Log;

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
    /**
     * Wall-clock budget for the whole driver-facing push step, mirroring
     * TripGeocoder::enrichForNotify's deadline guard: the accept window is ~5 s, so
     * the push must never be the thing that outlives it.
     */
    private const PUSH_BUDGET_SECONDS = 4.0;

    public function __construct(private PushSender $sender) {}

    /**
     * @return int number of the DRIVER's devices the offer was pushed to (the fleet
     *             owners' copy is queued — see {@see NotifyOwnersOfOffer})
     */
    public function notify(DispatchOffer $offer): int
    {
        if ($offer->driver_id === null) {
            return 0; // unlinked offers have no one to notify
        }

        // Real-time nudge to the driver's open app (WebSocket) so a fresh offer
        // appears instantly, alongside the push that wakes a closed app. Best
        // -effort: a broadcast failure (Reverb down) must never break ingestion.
        rescue(fn () => broadcast(new OfferBroadcast((int) $offer->driver_id, (int) $offer->tenant_id, (int) $offer->id, 'new')), report: false);

        $sent = $this->pushToDriver($offer, $this->buildTitle($offer), $this->buildBody($offer), $this->offerData($offer));

        // The owners' copy leaves the hot path: only the DRIVER has a 5-second
        // window, and a company with three managers in owner mode used to add three
        // more sequential FCM calls to it.
        NotifyOwnersOfOffer::dispatch((int) $offer->id);

        return $sent;
    }

    /**
     * The data payload every offer push carries. Built in ONE place: notify() and
     * notifyMultiStop() used to assemble near-identical arrays by hand, so a new
     * field had to be added twice — the duplication behind the non-Latin address bug
     * fixed on 2026-09-08.
     *
     * @return array<string, string>
     */
    private function offerData(DispatchOffer $offer, ?int $stopsCount = null): array
    {
        $data = [
            // Ties the push to the app's "offer" notification category so the
            // "Open in map" action button is rendered (see FcmPushSender::message).
            'categoryId' => 'offer',
            'offer_id' => (string) $offer->id,
            'offer_uuid' => (string) $offer->offer_uuid,
            'pickup' => $this->latinAddress($offer->pickup_display, $offer->pickup_address),
            'dropoff' => $this->latinAddress($offer->dropoff_display, $offer->dropoff_address),
            'pickup_lat' => (string) ($offer->pickup_lat ?? ''),
            'pickup_lng' => (string) ($offer->pickup_lng ?? ''),
            'dropoff_lat' => (string) ($offer->dropoff_lat ?? ''),
            'dropoff_lng' => (string) ($offer->dropoff_lng ?? ''),
            'geo_source' => (string) ($offer->geo_source ?? ''),
            'fare' => (string) ($offer->fare_formatted ?? ''),
            'fare_amount' => (string) ($offer->fare_amount ?? ''),
            'distance_m' => (string) ($offer->distance_m ?? ''),
            'accept_window' => (string) ($offer->accept_window_seconds ?? ''),
            'received_at' => optional($offer->received_at)->toIso8601String() ?? '',
            // Every stop as JSON so the app can route the maps app through them all.
            'stops' => $this->stopsPayload($offer),
        ];

        // Only the multi-stop alert carries the count (it also picks the app's urgent
        // channel + sound in FcmPushSender::message).
        if ($stopsCount !== null) {
            $data['stops_count'] = (string) $stopsCount;
        }

        return $data;
    }

    /**
     * Push to the driver's own devices — in parallel where the transport supports it
     * — inside a wall-clock budget.
     *
     * @param  array<string, string>  $data
     */
    private function pushToDriver(DispatchOffer $offer, string $title, string $body, array $data): int
    {
        $tokens = DeviceToken::where('driver_id', $offer->driver_id)->pluck('token')->all();

        return $this->push($tokens, $title, $body, $data);
    }

    /**
     * @param  array<int, string>  $tokens
     * @param  array<string, string>  $data
     */
    private function push(array $tokens, string $title, string $body, array $data): int
    {
        if ($tokens === []) {
            return 0;
        }

        if ($this->sender instanceof SendsPushInBulk) {
            return $this->sender->sendMany($tokens, $title, $body, $data);
        }

        // Sequential fallback (log transport / tests): stop rather than run past the
        // window if the transport turns slow, so a stalled device never delays the rest.
        $deadline = microtime(true) + self::PUSH_BUDGET_SECONDS;
        $sent = 0;
        foreach ($tokens as $i => $token) {
            if ($i > 0 && microtime(true) >= $deadline) {
                Log::warning('push.budget_exhausted', ['skipped' => count($tokens) - $i]);
                break;
            }
            if ($this->sender->send($token, $title, $body, $data)) {
                $sent++;
            }
        }

        return $sent;
    }

    /**
     * Fan an offer out to the tenant's fleet owners/managers who registered a device
     * in owner mode. The driver's own push is unchanged; the owner's copy carries the
     * driver name so they know whose offer it is.
     *
     * Runs on the QUEUE ({@see NotifyOwnersOfOffer}) — owners have no accept window,
     * so this must not sit inside the driver's. Also covers the multi-stop follow-up,
     * which a manager in owner mode previously never received.
     *
     * @param  int|null  $stopsCount  set for the multi-stop follow-up
     * @return int number of owner devices notified
     */
    public function notifyOwners(DispatchOffer $offer, ?int $stopsCount = null): int
    {
        // Scope explicitly by the offer's tenant (bypass the global scope): owner
        // tokens are the tenant's, keyed by user_id, never a driver.
        $tokens = DeviceToken::withoutGlobalScopes()
            ->where('tenant_id', $offer->tenant_id)
            ->whereNotNull('user_id')
            ->pluck('token')
            ->all();

        if ($tokens === []) {
            return 0;
        }

        // Fleet-manager layout (4 lines): numbers on the title, then driver · rider,
        // then pickup, then drop-off — so the manager reads whose offer it is at a
        // glance. (The driver's own push keeps the rider on the title line.)
        $isMultiStop = $stopsCount !== null;
        $ownerTitle = $isMultiStop ? $this->multiStopTitle($offer) : $this->buildNumbers($offer);
        $body = $isMultiStop ? $this->multiStopBody($offer, $stopsCount) : $this->buildBody($offer);

        $driverName = $this->driverName($offer);
        $rider = trim((string) $offer->rider_first_name);
        $names = trim($driverName.($rider !== '' ? ' · '.$rider : ''));
        $ownerBody = $names !== '' ? trim($names."\n".$body) : $body;

        return $this->push($tokens, $ownerTitle, $ownerBody, $this->offerData($offer, $stopsCount));
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

    /** Localized "multi-stop detected" title for the second (multi-stop) push. */
    private function multiStopTitle(DispatchOffer $offer): string
    {
        return match ($offer->driver?->locale) {
            'en' => 'Multi-stop detected',
            'ar' => 'تم اكتشاف نقاط متعددة',
            default => 'Zwischenstopp erkannt',
        };
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
        rescue(fn () => broadcast(new OfferBroadcast((int) $offer->driver_id, (int) $offer->tenant_id, (int) $offer->id, 'multistop')), report: false);

        // A worded, localized title so the driver instantly reads WHY a second push
        // arrived (Uber revealed extra drop-offs). This one notification is
        // intentionally localized (unlike the word-free single-offer push).
        $title = $this->multiStopTitle($offer);
        $body = $this->multiStopBody($offer, $stopsCount);

        $sent = $this->pushToDriver($offer, $title, $body, $this->offerData($offer, $stopsCount));

        // The manager in owner mode gets the follow-up too — they used to receive the
        // first offer push and then never hear about the extra drop-offs.
        NotifyOwnersOfOffer::dispatch((int) $offer->id, $stopsCount);

        return $sent;
    }

    /**
     * The multi-stop body: a blue stop marker + the stop count, distance and €/km on
     * the first line, then EVERY stop on its own bulleted line (pickup, then each
     * drop-off with its "+km") — so the driver reads all destinations and pricing
     * from the lock screen. (An OS push carries only an emoji, not our blue-circle
     * stop icon; the app renders the real marker in its own UI.)
     */
    private function multiStopBody(DispatchOffer $offer, int $stopsCount): string
    {
        $metrics = $this->buildMetrics($offer);
        $head = trim('🔵 x'.$stopsCount.($metrics !== '' ? ' · '.$metrics : ''));

        return trim($head."\n".$this->buildStopBullets($offer));
    }

    /**
     * Every stop as a compact JSON array — `[{"address":"…","leg_m":1234}, …]` in
     * route order (pickup first, each drop-off after) — so the app can route the
     * maps app through all of them and render per-stop detail from the push alone.
     * Empty string when the trip has no resolved multi-stop itinerary.
     */
    private function stopsPayload(DispatchOffer $offer): string
    {
        $stops = is_array($offer->stops) ? $offer->stops : [];
        $out = [];
        foreach ($stops as $s) {
            $address = $this->cleanAddress($s['address'] ?? null);
            if ($address === '') {
                continue;
            }
            $out[] = ['address' => $address, 'lat' => $s['lat'] ?? null, 'lng' => $s['lng'] ?? null, 'leg_m' => $s['leg_m'] ?? null];
        }

        return $out === [] ? '' : (string) json_encode($out, JSON_UNESCAPED_UNICODE);
    }

    /**
     * The multi-stop body: every stop on its own bulleted line — pickup first, then
     * each drop-off with its per-leg "+km" — so the driver reads the whole itinerary
     * on the lock screen. Falls back to the two-address body when the stops itinerary
     * is unresolved.
     */
    private function buildStopBullets(DispatchOffer $offer): string
    {
        $stops = is_array($offer->stops) ? $offer->stops : [];
        if (count($stops) < 2) {
            return $this->buildBody($offer);
        }

        $lines = [];
        foreach ($stops as $i => $s) {
            $address = $this->cleanAddress($s['address'] ?? null);
            if ($address === '') {
                continue;
            }
            // Pickup carries no leg; each drop-off shows the extra km from the previous stop.
            $legM = $s['leg_m'] ?? null;
            $leg = $i > 0 && $legM !== null ? ' (+'.number_format((float) $legM / 1000, 1, '.', '').' km)' : '';
            $lines[] = '• '.$address.$leg;
        }

        return $lines === [] ? $this->buildBody($offer) : implode("\n", $lines);
    }

    /** "pickup\ndropoff" — the two addresses, country stripped, no separator arrow. */
    private function buildBody(DispatchOffer $offer): string
    {
        $pickup = $this->latinAddress($offer->pickup_display, $offer->pickup_address);
        $dropoff = $this->latinAddress($offer->dropoff_display, $offer->dropoff_address);

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
        // A street-level (or straight-line 'estimated') geocode gives an APPROXIMATE
        // distance — the point sits mid-street, not on the exact house — so prefix a
        // "~" until an exact source (the accept's Uber waypoints) upgrades it. Uber
        // waypoints set geo_confidence='exact', so a resolved trip drops the "~".
        $approx = $offer->geo_confidence !== null && $offer->geo_confidence !== 'exact';
        $parts = [($approx ? '~' : '').number_format($km, 1, '.', '').' km'];

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

    /**
     * A guaranteed-Latin address for the push — Uber localizes an offer's address
     * text to the RIDER's app language, so a non-Latin ("德国…: 42103") value must
     * never reach the driver. Prefers the resolved display, replaces a non-Latin
     * string with the German "<PLZ> City". Same rule as the API resource.
     */
    private function latinAddress(?string $display, ?string $raw): string
    {
        return AddressLatinizer::toLatin($display, $raw) ?? '';
    }
}
