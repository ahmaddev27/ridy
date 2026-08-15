<?php

namespace App\Domain\Notifications;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;

/**
 * Turns a routed dispatch offer into a push to every device of its linked driver.
 * The message carries the full offer detail so the app can render its own
 * countdown card, and is localized to the driver's chosen language.
 */
class DispatchNotifier
{
    /** Notification title per driver locale. */
    private const TITLES = [
        'de' => 'Neues Uber-Angebot',
        'en' => 'New Uber offer',
        'ar' => 'عرض أوبر جديد',
    ];

    public function __construct(private PushSender $sender) {}

    /**
     * @return int number of devices the offer was pushed to
     */
    public function notify(DispatchOffer $offer): int
    {
        if ($offer->driver_id === null) {
            return 0; // unlinked offers have no one to notify
        }

        $locale = $offer->driver?->locale ?: 'de';
        $title = self::TITLES[$locale] ?? self::TITLES['de'];
        $body = $this->buildBody($offer);
        $data = [
            'offer_id' => (string) $offer->id,
            'offer_uuid' => (string) $offer->offer_uuid,
            'pickup' => (string) ($offer->pickup_address ?? ''),
            'dropoff' => (string) ($offer->dropoff_address ?? ''),
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

        return $sent;
    }

    private function buildBody(DispatchOffer $offer): string
    {
        $parts = array_filter([
            $offer->fare_formatted,
            $offer->pickup_address,
        ]);

        return $parts ? implode(' · ', $parts) : 'Uber';
    }
}
