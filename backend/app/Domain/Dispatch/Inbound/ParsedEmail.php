<?php

namespace App\Domain\Dispatch\Inbound;

/**
 * The few things the inbound handler reads from a message. Held in memory for the
 * duration of one ingest and never persisted: the bodies can carry a one-time code.
 */
final class ParsedEmail
{
    /**
     * @param  array<string, list<string>>  $headers  lower-cased name => unfolded values
     */
    public function __construct(
        public readonly array $headers,
        public readonly string $subject,
        public readonly string $text,
        public readonly string $html,
    ) {}

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)][0] ?? null;
    }

    /** @return list<string> */
    public function headerAll(string $name): array
    {
        return $this->headers[strtolower($name)] ?? [];
    }

    public function messageId(): ?string
    {
        $id = trim((string) $this->header('message-id'));

        return $id === '' ? null : $id;
    }

    public function sentAt(): ?int
    {
        $date = $this->header('date');
        $ts = $date === null ? false : strtotime($date);

        return $ts === false ? null : $ts;
    }

    /** Best-effort: our own MTA vouched for an Uber DKIM signature (never required). */
    public function hasUberDkimPass(): bool
    {
        foreach ($this->headerAll('authentication-results') as $result) {
            if (preg_match('/dkim=pass/i', $result) === 1 && preg_match('/header\.(d|i)=@?(?:[a-z0-9.-]+\.)?uber\.com/i', $result) === 1) {
                return true;
            }
        }

        return false;
    }
}
