<?php

namespace App\Domain\Dispatch\Inbound;

use App\Domain\Audit\AuditLogger;
use App\Domain\Dispatch\PasswordlessLoginService;
use App\Domain\Dispatch\PasswordlessLoginSettings;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Variant B: turns a forwarded Uber code email into the code submission variant A already
 * has. Transport-agnostic - it gets the raw RFC 5322 message and the recipient the MTA
 * accepted it for (Postfix pipe today; any other transport can call it the same way).
 *
 * Trust, in order (docs/27 + the parsing spec): the secret per-company address, a PENDING
 * automatic login for that company inside its window, and a one-shot Message-ID guard. A
 * valid Uber DKIM is only a recorded positive signal - forwarded mail often loses it, so
 * its absence never rejects. A forged email can at worst submit a wrong code, which Uber
 * rejects; the real code only ever reaches the company's own inbox.
 *
 * DSGVO: the message and the code live in local variables for this call only. Nothing of
 * either is stored or logged; the audit trail gets tenant, outcome and a DKIM flag.
 */
class InboundMailHandler
{
    public const SUBMITTED = 'submitted';

    /** Seconds before a login started that a message may be dated (clock skew / queueing). */
    private const DATE_SLACK_BEFORE = 60;

    private const DATE_SLACK_AFTER = 120;

    private const RATE_PER_MINUTE = 10;

    public function __construct(
        private readonly MimeParser $parser,
        private readonly UberCodeExtractor $extractor,
        private readonly ReplayGuard $replay,
        private readonly PasswordlessLoginSettings $settings,
        private readonly PasswordlessLoginService $login,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * @return string `submitted`, or the reason the message was dropped:
     *                unknown_address | not_enabled | rate_limited | no_pending | stale | no_message_id | replay | no_code
     */
    public function handle(string $raw, ?string $recipient = null): string
    {
        $mail = $this->parser->parse($raw);
        unset($raw);

        $tenant = $this->tenantFor($recipient ?? $this->recipientFromHeaders($mail));
        if ($tenant === null) {
            return $this->drop(null, 'unknown_address');
        }
        $reason = $this->rejection($tenant, $mail);
        if ($reason !== null) {
            return $this->drop($tenant, $reason);
        }

        $code = $this->extractor->extract($mail);
        if ($code === null) {
            return $this->drop($tenant, 'no_code');
        }
        $this->audit->log('uber_login.inbound', null, ['outcome' => self::SUBMITTED, 'dkim' => $mail->hasUberDkimPass()], $tenant->id);
        $this->login->submitCode($tenant, $code, PasswordlessLoginService::SOURCE_INBOUND);
        unset($code, $mail);

        return self::SUBMITTED;
    }

    /** The cheap checks, ordered so the replay guard is only spent on a message that could count. */
    private function rejection(Tenant $tenant, ParsedEmail $mail): ?string
    {
        if (! $this->settings->autoCodeEnabled($tenant)) {
            return 'not_enabled';
        }
        $key = 'uber_login:inbound:'.$tenant->id;
        if (RateLimiter::tooManyAttempts($key, self::RATE_PER_MINUTE)) {
            return 'rate_limited';
        }
        RateLimiter::hit($key, 60);

        $attempt = $this->login->pendingAutoAttempt($tenant);
        if ($attempt === null) {
            return 'no_pending';
        }
        if (! $this->dateWithinWindow($mail->sentAt(), (string) ($attempt['started_at'] ?? ''))) {
            return 'stale';
        }
        $messageId = $mail->messageId();
        if ($messageId === null) {
            return 'no_message_id';
        }

        return $this->replay->first($messageId) ? null : 'replay';
    }

    private function dateWithinWindow(?int $sentAt, string $startedAt): bool
    {
        $start = strtotime($startedAt);
        if ($sentAt === null || $start === false) {
            return true; // no usable date: the pending window and replay guard still apply
        }

        return $sentAt >= $start - self::DATE_SLACK_BEFORE && $sentAt <= time() + self::DATE_SLACK_AFTER;
    }

    private function tenantFor(?string $recipient): ?Tenant
    {
        $token = $recipient === null ? null : $this->settings->tokenFromRecipient($this->bareAddress($recipient));
        if ($token === null) {
            return null;
        }

        return Tenant::query()
            ->where('settings->passwordless_login->inbound_token_hash', $this->settings->hashToken($token))
            ->first();
    }

    private function recipientFromHeaders(ParsedEmail $mail): ?string
    {
        foreach (['x-original-to', 'delivered-to', 'envelope-to', 'to'] as $name) {
            foreach ($mail->headerAll($name) as $value) {
                if ($this->settings->tokenFromRecipient($this->bareAddress($value)) !== null) {
                    return $value;
                }
            }
        }

        return null;
    }

    /** "Name <a@b>" / "<a@b>" / "a@b" -> "a@b". */
    private function bareAddress(string $value): string
    {
        return preg_match('/<([^>]+)>/', $value, $m) === 1 ? trim($m[1]) : trim($value);
    }

    /** Drops are counted by reason only - never with message content. */
    private function drop(?Tenant $tenant, string $reason): string
    {
        Log::info('uber_login.inbound_drop', ['reason' => $reason, 'tenant_id' => $tenant?->id]);

        return $reason;
    }
}
