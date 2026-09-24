<?php

namespace App\Domain\Notifications;

use App\Domain\Notifications\Jobs\SendRenderedMail;
use Illuminate\Support\Facades\Mail;

/**
 * Renders a stored email template (subject + HTML, variables filled) and sends
 * it via the configured mailer. When SMTP is unset the app's `log` mailer
 * writes the mail (and its OTP) to the log — handy in development.
 *
 * `to()` renders now and QUEUES the delivery, so no request (OTP, invite, daemon
 * callback) waits on SMTP and known/unknown accounts answer in the same time.
 * `now()` sends inline for callers that must surface the transport error.
 */
class SendTemplatedMail
{
    /** @param array<string, string> $vars */
    public static function to(string $email, string $key, array $vars): void
    {
        $rendered = self::render($key, $vars);
        if ($rendered === null) {
            return; // template missing — nothing to send
        }

        SendRenderedMail::dispatch($email, $rendered['subject'], $rendered['html']);
    }

    /** @param array<string, string> $vars */
    public static function now(string $email, string $key, array $vars): void
    {
        $rendered = self::render($key, $vars);
        if ($rendered === null) {
            return;
        }

        Mail::html($rendered['html'], function ($message) use ($email, $rendered) {
            $message->to($email)->subject($rendered['subject']);
        });
    }

    /**
     * The brand logo is referenced by an absolute hosted URL (served by Caddy
     * from Laravel public/email), so no inline attachment is needed.
     *
     * @param  array<string, string>  $vars
     * @return array{subject: string, html: string}|null
     */
    private static function render(string $key, array $vars): ?array
    {
        $rendered = app(EmailTemplateRenderer::class)->render($key, $vars);

        return $rendered['html'] === '' ? null : $rendered;
    }
}
