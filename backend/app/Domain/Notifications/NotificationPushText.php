<?php

namespace App\Domain\Notifications;

/**
 * Localized title/body for a web push, per notification type and user language.
 * Mirrors the in-app bell copy so the push and the bell read the same. Unknown
 * types fall back to a generic Reidey line rather than failing.
 */
class NotificationPushText
{
    /** type => locale => [title, body] with {param} placeholders. */
    private const MAP = [
        'session_connected' => [
            'de' => ['Uber verbunden', '{company}: die Uber-Sitzung ist aktiv.'],
            'en' => ['Uber connected', '{company}: the Uber session is active.'],
            'ar' => ['تم ربط أوبر', '{company}: جلسة أوبر أصبحت نشطة.'],
        ],
        'session_needs_relink' => [
            'de' => ['Uber erneut verbinden', '{company}: die Uber-Sitzung muss erneuert werden.'],
            'en' => ['Reconnect Uber', '{company}: the Uber session needs relinking.'],
            'ar' => ['أعد ربط أوبر', '{company}: جلسة أوبر تحتاج إعادة ربط.'],
        ],
        'company_registered' => [
            'de' => ['Neue Firma', '{company} hat sich registriert.'],
            'en' => ['New company', '{company} just registered.'],
            'ar' => ['شركة جديدة', 'سجّلت شركة {company}.'],
        ],
        'company_banned' => [
            'de' => ['Firma gesperrt', '{company} wurde gesperrt.'],
            'en' => ['Company banned', '{company} was banned.'],
            'ar' => ['حظر شركة', 'تم حظر {company}.'],
        ],
        'subscription_activated' => [
            'de' => ['Abo aktiviert', 'Dein Abo läuft für {days} Tage.'],
            'en' => ['Subscription active', 'Your subscription runs for {days} days.'],
            'ar' => ['تفعيل الاشتراك', 'اشتراكك فعّال لمدة {days} يوم.'],
        ],
        'subscription_free' => [
            'de' => ['Gratis-Abo', 'Du hast {days} Gratis-Tage erhalten.'],
            'en' => ['Free subscription', 'You received {days} free days.'],
            'ar' => ['اشتراك مجاني', 'حصلت على {days} يوم مجاني.'],
        ],
        'subscription_expiring' => [
            'de' => ['Abo läuft bald ab', 'Noch {days} Tage.'],
            'en' => ['Subscription ending', '{days} days left.'],
            'ar' => ['اشتراكك قارب على الانتهاء', 'باقي {days} يوم.'],
        ],
        'subscription_expired' => [
            'de' => ['Abo abgelaufen', 'Dein Abo ist abgelaufen.'],
            'en' => ['Subscription expired', 'Your subscription has expired.'],
            'ar' => ['انتهى الاشتراك', 'انتهى اشتراكك.'],
        ],
        'proxy_expiring' => [
            'de' => ['Proxy läuft bald ab', '{label} läuft in {days} Tagen ab.'],
            'en' => ['Proxy expiring', '{label} expires in {days} days.'],
            'ar' => ['بروكسي قارب على الانتهاء', '{label} ينتهي خلال {days} يوم.'],
        ],
        'code_activated' => [
            'de' => ['Code eingelöst', '{company} hat den Code {code} eingelöst.'],
            'en' => ['Code redeemed', '{company} redeemed code {code}.'],
            'ar' => ['تم تفعيل كود', 'فعّلت {company} الكود {code}.'],
        ],
    ];

    /**
     * @param  array<string, mixed>  $params
     * @return array{title: string, body: string}
     */
    public function for(string $type, array $params, string $locale): array
    {
        // A super-admin broadcast carries its own free-form copy in params —
        // there is no fixed per-type/locale template to look up.
        if ($type === 'admin_broadcast') {
            return [
                'title' => (string) ($params['title'] ?? 'Reidey'),
                'body' => (string) ($params['body'] ?? ''),
            ];
        }

        $entry = self::MAP[$type][$locale] ?? self::MAP[$type]['de'] ?? ['Reidey', ''];

        return [
            'title' => $this->interpolate($entry[0], $params),
            'body' => $this->interpolate($entry[1], $params),
        ];
    }

    /** @param array<string, mixed> $params */
    private function interpolate(string $text, array $params): string
    {
        foreach ($params as $key => $value) {
            $text = str_replace('{'.$key.'}', (string) $value, $text);
        }

        return $text;
    }
}
