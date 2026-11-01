<?php

namespace Tests\Unit;

use App\Domain\Dispatch\Inbound\MimeParser;
use App\Domain\Dispatch\Inbound\ParsedEmail;
use App\Domain\Dispatch\Inbound\UberCodeExtractor;
use PHPUnit\Framework\TestCase;

class UberCodeExtractorTest extends TestCase
{
    private function mail(string $subject, string $text = '', string $html = ''): ParsedEmail
    {
        return new ParsedEmail([], $subject, $text, $html);
    }

    /** A multipart/alternative message shaped like Uber's: quoted-printable parts, stuffed preheader. */
    private function uberRaw(string $subject = 'Do not share: 0033', string $code = '0033'): string
    {
        $preheader = "You'll need this code to finish logging in.=CD=8F =C2=AD =CD=8F =C2=AD 4821 =CD=8F =C2=AD";

        return "From: Uber <admin@uber.com>\r\nTo: uber-x@in.reidey.de\r\nSubject: {$subject}\r\n"
            ."MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"b1\"\r\n\r\n"
            ."--b1\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n"
            ."Your Uber verification code\r\n\r\nTo finish logging in to your Uber account, enter this verification code:\r\n\r\n{$code}\r\n\r\n"
            ."Do not share this code with anyone.\r\n"
            ."--b1\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n"
            ."<html><body><div style=3D\"display:none\">{$preheader}</div><p>enter this verification code:</p>"
            ."<table><tr><td style=3D\"font-weight:bold\">{$code}</td></tr></table></body></html>\r\n--b1--\r\n";
    }

    private function extract(ParsedEmail $mail): ?string
    {
        return (new UberCodeExtractor)->extract($mail);
    }

    public function test_the_code_comes_from_the_subject(): void
    {
        $this->assertSame('1234', $this->extract($this->mail('Do not share: 1234')));
        $this->assertSame('1234', $this->extract($this->mail('Fwd: Do not share: 1234')));
    }

    public function test_leading_zeros_survive_because_the_code_is_a_string(): void
    {
        $this->assertSame('0033', $this->extract($this->mail('Do not share: 0033')));
        $this->assertSame('0000', $this->extract($this->mail('Do not share: 0000')));
    }

    public function test_falls_back_to_the_text_body_next_to_the_phrase(): void
    {
        $text = "Your Uber verification code\n\nTo finish logging in, enter this verification code:\n\n0457\n\nDo not share this code.";

        $this->assertSame('0457', $this->extract($this->mail('Your Uber code', $text)));
    }

    public function test_falls_back_to_the_html_cell_when_there_is_no_text_part(): void
    {
        $html = '<p>enter this verification code:</p><table><tr><td style="font-weight:bold">0611</td></tr></table>';

        $this->assertSame('0611', $this->extract($this->mail('Your Uber code', '', $html)));
    }

    public function test_the_preheader_and_invisible_characters_are_ignored(): void
    {
        $html = "<div style=\"display:none\">You'll need this code\u{034F}\u{00AD} 9999 \u{034F}\u{00AD}</div>"
            .'<p>enter this verification code:</p><td>0033</td>';

        $this->assertSame('0033', $this->extract($this->mail('Your Uber code', '', $html)));
        // invisible characters inside the subject do not hide the code either
        $this->assertSame('0033', $this->extract($this->mail("Do not\u{00AD} share:\u{034F} 0033")));
    }

    public function test_ambiguous_mail_yields_null(): void
    {
        $two = "enter this verification code: 1111\nenter this verification code: 2222";
        $this->assertNull($this->extract($this->mail('Your Uber code', $two)));
        // subject and body disagree: never guess
        $this->assertNull($this->extract($this->mail('Do not share: 1111', 'enter this verification code: 2222')));
    }

    public function test_mail_without_a_code_yields_null(): void
    {
        $this->assertNull($this->extract($this->mail('Welcome to Uber', 'Thanks for riding. 2026 Uber Technologies')));
        $this->assertNull($this->extract($this->mail('Do not share: 12')));
        $this->assertNull($this->extract($this->mail('Do not share: 12345')));
    }

    public function test_a_real_shaped_multipart_message_parses_end_to_end(): void
    {
        $mail = (new MimeParser)->parse($this->uberRaw());

        $this->assertSame('Do not share: 0033', $mail->subject);
        $this->assertStringContainsString('0033', $mail->text);
        $this->assertSame('0033', $this->extract($mail));
    }

    public function test_the_stuffed_preheader_number_is_never_taken_from_a_real_shaped_message(): void
    {
        // No usable subject: the body fallback must pick the code cell (0033), not the preheader's 4821.
        $mail = (new MimeParser)->parse($this->uberRaw('Your Uber code'));

        $this->assertSame('0033', $this->extract($mail));
    }

    public function test_base64_encoded_and_encoded_word_subjects_are_decoded(): void
    {
        $raw = "Subject: =?UTF-8?B?RG8gbm90IHNoYXJlOiAwMDMz?=\r\nContent-Type: text/plain; charset=UTF-8\r\n"
            ."Content-Transfer-Encoding: base64\r\n\r\n".base64_encode("enter this verification code:\n0033")."\r\n";
        $mail = (new MimeParser)->parse($raw);

        $this->assertSame('Do not share: 0033', $mail->subject);
        $this->assertSame('0033', $this->extract($mail));
    }

    public function test_a_forwarded_rfc822_attachment_is_read(): void
    {
        $inner = $this->uberRaw();
        $raw = "Subject: Fwd: x\r\nContent-Type: multipart/mixed; boundary=\"m\"\r\n\r\n--m\r\nContent-Type: text/plain\r\n\r\nFYI\r\n"
            ."--m\r\nContent-Type: message/rfc822\r\n\r\n{$inner}\r\n--m--\r\n";
        $mail = (new MimeParser)->parse($raw);

        $this->assertSame('0033', $this->extract($mail));
    }
}
