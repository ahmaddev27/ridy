<?php

namespace App\Domain\Notifications;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;

/**
 * Turns a routed dispatch offer into a push to every device of its linked driver.
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

        $tokens = DeviceToken::where('driver_id', $offer->driver_id)->get();

        $title = 'Neues Uber-Angebot';
        $body = $this->buildBody($offer);
        $data = [
            'offer_uuid' => (string) $offer->offer_uuid,
            'pickup' => (string) ($offer->pickup_address ?? ''),
            'dropoff' => (string) ($offer->dropoff_address ?? ''),
            'fare' => (string) ($offer->fare_formatted ?? ''),
            'accept_window' => (string) ($offer->accept_window_seconds ?? ''),
        ];

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
            $offer->pickup_address ? 'Abholung: '.$offer->pickup_address : null,
        ]);

        return $parts ? implode(' · ', $parts) : 'Ein neues Fahrtangebot ist verfügbar.';
    }
}
