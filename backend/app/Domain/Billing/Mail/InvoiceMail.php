<?php

namespace App\Domain\Billing\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Emails a paid subscription invoice with the rendered PDF attached. The PDF
 * bytes are passed in already rendered so the mailable stays a thin transport
 * and carries no domain logic.
 */
class InvoiceMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        private readonly string $invoiceNo,
        private readonly string $customerName,
        private readonly string $pdfBytes,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Ihre Reidey Rechnung '.$this->invoiceNo);
    }

    public function content(): Content
    {
        return new Content(
            htmlString: '<p>Guten Tag '.e($this->customerName).',</p>'
                .'<p>vielen Dank für Ihr Vertrauen in Reidey. Im Anhang finden Sie Ihre '
                .'Rechnung <strong>'.e($this->invoiceNo).'</strong> als PDF.</p>'
                .'<p>Mit freundlichen Grüßen<br>Ihr Reidey-Team</p>',
        );
    }

    /** @return array<int, Attachment> */
    public function attachments(): array
    {
        return [
            Attachment::fromData(fn () => $this->pdfBytes, $this->invoiceNo.'.pdf')
                ->withMime('application/pdf'),
        ];
    }
}
