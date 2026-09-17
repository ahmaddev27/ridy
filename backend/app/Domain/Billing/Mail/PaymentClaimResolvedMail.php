<?php

namespace App\Domain\Billing\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Tells a company the outcome of its payment claim: confirmed (the admin verified
 * the transfer and will issue/has issued the activation code) or rejected (with
 * the admin's reason). Sent in both cases. German, matching the invoice mail.
 */
class PaymentClaimResolvedMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        private readonly string $customerName,
        private readonly string $reference,
        private readonly bool $confirmed,
        private readonly ?string $reason = null,
        private readonly ?string $activationCode = null,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: $this->confirmed
                ? 'Reidey · Zahlung bestätigt ('.$this->reference.')'
                : 'Reidey · Zahlung nicht bestätigt ('.$this->reference.')',
        );
    }

    public function content(): Content
    {
        $intro = '<p>Guten Tag '.e($this->customerName).',</p>';
        $refLine = '<p>Zahlungsreferenz: <strong>'.e($this->reference).'</strong></p>';

        if ($this->confirmed) {
            $codeBlock = $this->activationCode !== null && $this->activationCode !== ''
                ? '<p>Ihr Aktivierungscode: <strong style="font-size:18px;letter-spacing:2px">'
                    .e($this->activationCode).'</strong> (1 Stunde gültig)</p>'
                    .'<p>Geben Sie ihn auf der Abo-Seite ein, um Ihr Abonnement zu aktivieren.</p>'
                : '<p>Ihr Aktivierungscode wird Ihnen in Kürze bereitgestellt.</p>';
            $body = '<p>wir haben Ihre Zahlung erhalten und bestätigt.</p>'.$codeBlock;
        } else {
            $reasonBlock = $this->reason !== null && $this->reason !== ''
                ? '<p>Grund: '.e($this->reason).'</p>'
                : '';
            $body = '<p>wir konnten Ihre Zahlung leider nicht bestätigen.</p>'.$reasonBlock
                .'<p>Bitte prüfen Sie Ihre Überweisung (inkl. der Zahlungsreferenz) '
                .'und kontaktieren Sie uns bei Fragen.</p>';
        }

        return new Content(
            htmlString: $intro.$body.$refLine.'<p>Mit freundlichen Grüßen<br>Ihr Reidey-Team</p>',
        );
    }
}
