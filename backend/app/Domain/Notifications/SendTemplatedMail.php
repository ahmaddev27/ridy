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

        $logo = public_path('email/reidey-logo.png');
        $embedLogo = str_contains($rendered['html'], 'cid:reidey-logo.png') && is_file($logo);

        Mail::html($rendered['html'], function ($message) use ($email, $rendered, $embedLogo, $logo) {
            $message->to($email)->subject($rendered['subject']);
            // Inline the brand logo by Content-ID so it renders without a reachable URL.
            if ($embedLogo) {
                $message->embedData(file_get_contents($logo), 'reidey-logo.png', 'image/png');
            }
        });
    }
}
