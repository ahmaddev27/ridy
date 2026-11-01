<?php

namespace App\Domain\Dispatch\Inbound;

/**
 * Reads Uber's 4-digit verification code out of its email (spec: scratchpad
 * uber-otp-email-parsing-spec.md). The code is ZERO-PADDED ("0033") and is therefore always
 * a 4-character STRING, never an int.
 *
 *   1. Subject  "Do not share: 0033"  (also inside "Fwd: ...") - authoritative
 *   2. Body     the 4-digit token that comes DIRECTLY after "verification code"
 *
 * Never reads the preheader: it is stuffed with invisible anti-scrape characters
 * (U+034F, U+00AD, zero-width) which are stripped, and only the token right after the
 * "verification code" phrase is considered. Anything ambiguous returns null.
 */
class UberCodeExtractor
{
    /** Invisible characters Uber pads its preheader with. */
    private const INVISIBLE = '/[\x{034F}\x{00AD}\x{200B}-\x{200D}\x{2060}\x{FEFF}]/u';

    /** Anchors checked per message; Uber's mail has two, so a flood of the phrase is junk. */
    private const MAX_ANCHORS = 10;

    /**
     * The Subject is authoritative. The body is only a fallback, and it can neither replace
     * a valid Subject code with a stray number nor cancel it: only a genuinely different
     * CODE (the token right after the phrase) in the body makes the message ambiguous.
     */
    public function extract(ParsedEmail $mail): ?string
    {
        $subject = $this->fromSubject($mail->subject);
        $body = $this->fromBody($mail);

        if ($subject !== null) {
            return $body !== null && $body !== $subject ? null : $subject;
        }

        return $body;
    }

    private function fromSubject(string $subject): ?string
    {
        $clean = $this->clean($subject);

        return preg_match('/Do not share:\s*(\d{4})(?!\d)/i', $clean, $m) === 1 ? $m[1] : null;
    }

    /** The 4-digit token that FOLLOWS "verification code" directly; two different ones = ambiguous. */
    private function fromBody(ParsedEmail $mail): ?string
    {
        $text = $this->clean($mail->text !== '' ? $mail->text : $this->htmlToText($mail->html));
        if (preg_match_all('/verification code/i', $text, $anchors, PREG_OFFSET_CAPTURE) === 0) {
            return null;
        }
        $codes = [];
        foreach (array_slice($anchors[0], 0, self::MAX_ANCHORS) as [$phrase, $offset]) {
            // \G: the number must be the next thing after the phrase (only spaces and
            // punctuation in between) - a year or postcode further on never counts.
            $at = $offset + strlen($phrase);
            if (preg_match('/\G[^\p{L}\p{N}]*(\d{4})(?!\d)/u', $text, $m, 0, $at) === 1) {
                $codes[(string) $m[1]] = true;
            }
        }

        return count($codes) === 1 ? (string) array_key_first($codes) : null;
    }

    private function htmlToText(string $html): string
    {
        // Linear passes only (no lazy "<script>...</script>" matching, which goes quadratic
        // on thousands of unclosed tags): block ends become newlines, then strip_tags.
        $html = (string) preg_replace('/<\/(?:td|tr|p|div|h\d)>|<br\s*\/?>/i', "\n", $html);

        return html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    private function clean(string $text): string
    {
        return (string) preg_replace(self::INVISIBLE, '', $text);
    }
}
