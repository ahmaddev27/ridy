<?php

namespace App\Domain\Notifications;

use Illuminate\Support\Facades\Mail;

/**
 * Renders a stored email template (subject + HTML, variables filled) and sends
 * it via the configured SMTP mailer. When SMTP is unset the app's `log` mailer
 * writes the mail (and its OTP) to the log — handy in development.
 */
class SendTemplatedMail
{
    /** @param array<string, string> $vars */
    public static function to(string $email, string $key, array $vars): void
    {
        $rendered = app(EmailTemplateRenderer::class)->render($key, $vars);
        if ($rendered['html'] === '') {
            return; // template missing — nothing to send
        }

        Mail::html($rendered['html'], function ($message) use ($email, $rendered) {
            $message->to($email)->subject($rendered['subject']);
        });
    }
}
