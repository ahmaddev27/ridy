<?php

namespace App\Domain\Notifications;

use Illuminate\Notifications\Notification;

/**
 * A single, generic in-app (bell) notification. It stores a stable semantic
 * `type` + structured `params` + an optional `href`, NOT pre-rendered text — so
 * the frontend renders the title/body/icon in each user's own language.
 */
class AppNotification extends Notification
{
    /**
     * @param  array<string, mixed>  $params
     */
    public function __construct(
        public string $type,
        public array $params = [],
        public ?string $href = null,
    ) {}

    /** @return array<int, string> */
    public function via(object $notifiable): array
    {
        return ['database'];
    }

    /** @return array<string, mixed> */
    public function toDatabase(object $notifiable): array
    {
        return [
            'type' => $this->type,
            'params' => $this->params,
            'href' => $this->href,
        ];
    }
}
