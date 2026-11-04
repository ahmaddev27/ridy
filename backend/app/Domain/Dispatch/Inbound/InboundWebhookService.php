<?php

namespace App\Domain\Dispatch\Inbound;

use App\Domain\Dispatch\PasswordlessLoginSettings;

/**
 * HTTPS receive path for the forwarded Uber code email (SendGrid Inbound Parse), for hosts
 * where port 25 is closed. It only adapts the webhook payload to what InboundMailHandler
 * already takes (a raw message + the accepted recipient) - the OTP extraction, tenant
 * lookup, replay guard and audit all stay in the handler.
 *
 * Preferred payload: Inbound Parse with "POST the raw, full MIME message" ticked (field
 * `email`). Without it, a minimal message is rebuilt from `headers` (an allowlist of them)
 * and the decoded `text`/`html` parts.
 */
class InboundWebhookService
{
    /** Same cap as the artisan pipe: far above any real code email. */
    public const MAX_BYTES = 262144;

    /** Headers worth keeping from SendGrid's `headers` blob; everything else is dropped. */
    private const KEPT_HEADERS = ['message-id', 'date', 'from', 'subject', 'authentication-results', 'received-spf'];

    public function __construct(
        private readonly InboundMailHandler $handler,
        private readonly PasswordlessLoginSettings $settings,
    ) {}

    /**
     * @param  array<string, mixed>  $payload  the Inbound Parse form fields
     * @return string the handler's outcome (`submitted` or a drop reason)
     */
    public function receive(array $payload): string
    {
        $recipient = $this->recipient($payload);
        $raw = $this->rawMessage($payload);
        if ($recipient === null || $raw === '' || strlen($raw) > self::MAX_BYTES) {
            return 'unknown_address';
        }

        return $this->handler->handle($raw, $recipient);
    }

    /** The first address (envelope first, then `to`) that is one of our secret `uber-<token>@<domain>` ones. */
    private function recipient(array $payload): ?string
    {
        foreach ([$this->envelopeTo($payload), (string) ($payload['to'] ?? '')] as $field) {
            preg_match_all('/[^\s<>,;"\']+@[^\s<>,;"\']+/', $field, $found);
            foreach ($found[0] as $address) {
                if ($this->settings->tokenFromRecipient($address) !== null) {
                    return $address;
                }
            }
        }

        return null;
    }

    private function envelopeTo(array $payload): string
    {
        $envelope = json_decode((string) ($payload['envelope'] ?? ''), true);
        $to = is_array($envelope) ? ($envelope['to'] ?? []) : [];

        return implode(' ', array_filter((array) $to, 'is_string'));
    }

    private function rawMessage(array $payload): string
    {
        $raw = $payload['email'] ?? null;
        if (is_string($raw) && $raw !== '') {
            return $raw;
        }

        return $this->rebuild($payload);
    }

    /** A minimal single-part message: kept headers + the decoded text (or html) as UTF-8 text/plain|html. */
    private function rebuild(array $payload): string
    {
        $text = (string) ($payload['text'] ?? '');
        $html = (string) ($payload['html'] ?? '');
        $headers = $this->keptHeaders((string) ($payload['headers'] ?? ''));
        if (! isset($headers['subject']) && isset($payload['subject'])) {
            $headers['subject'] = $this->singleLine((string) $payload['subject']);
        }
        $type = $text !== '' ? 'text/plain' : 'text/html';
        $lines = ["Content-Type: {$type}; charset=utf-8", 'Content-Transfer-Encoding: 8bit'];
        foreach ($headers as $name => $value) {
            $lines[] = ucfirst($name).': '.$value;
        }

        return implode("\r\n", $lines)."\r\n\r\n".($text !== '' ? $text : $html);
    }

    /** @return array<string, string> lower-cased name => single-line value, allowlisted names only */
    private function keptHeaders(string $blob): array
    {
        $kept = [];
        foreach (preg_split('/\r?\n(?![ \t])/', $blob) ?: [] as $line) {
            [$name, $value] = array_pad(explode(':', $line, 2), 2, '');
            $name = strtolower(trim($name));
            if (in_array($name, self::KEPT_HEADERS, true) && ! isset($kept[$name])) {
                $kept[$name] = $this->singleLine($value);
            }
        }

        return $kept;
    }

    private function singleLine(string $value): string
    {
        return trim((string) preg_replace('/\s+/', ' ', $value));
    }
}
