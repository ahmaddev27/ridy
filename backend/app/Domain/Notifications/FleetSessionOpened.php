<?php

namespace App\Domain\Notifications;

use App\Domain\Dispatch\Models\UberFleetSession;
use Illuminate\Notifications\Notification;

/**
 * Alerts the fleet's managers the moment an Uber session is opened — regardless
 * of how it was captured (interactive login, extension, or manual paste) — so an
 * operator can act on the fresh session (e.g. secure it) right away.
 */
class FleetSessionOpened extends Notification
{
    public function __construct(private UberFleetSession $session) {}

    /**
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return ['database'];
    }

    /**
     * @return array<string, mixed>
     */
    public function toDatabase(object $notifiable): array
    {
        return [
            'type' => 'fleet_session_opened',
            'title' => 'Uber-Sitzung geöffnet',
            'body' => 'Für Org '.$this->session->uber_org_uuid.' wurde eine neue Uber-Sitzung verbunden.',
            'uber_org_uuid' => $this->session->uber_org_uuid,
            'session_id' => $this->session->id,
        ];
    }
}
