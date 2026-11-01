<?php

namespace App\Domain\Dispatch\Inbound;

/**
 * Reads Uber's 4-digit verification code out of its email (spec: scratchpad
 * uber-otp-email-parsing-spec.md). The code is ZERO-PADDED ("0033") and is therefore always
 * a 4-character STRING, never an int.
 *
 *   1. Subject  "Do not share: 0033"  (also inside "Fwd: ...")
 *   2. Body     a standalone 4-digit token right after "verification code"
 *
 * Never reads the preheader: it is stuffed with invisible anti-scrape characters
 * (U+034F, U+00AD, zero-width) which are stripped, and only the text next to the
 * "verification code" phrase is considered. Anything ambiguous returns null.
 */
class UberCodeExtractor
{
    /** Invisible characters Uber pads its preheader with. */
    private const INVISIBLE = '/[\x{034F}\x{00AD}\x{200B}-\x{200D}\x{2060}\x{FEFF}]/u';

    /** How far after the phrase the code may sit. */
    private const WINDOW = 80;

    public function extract(ParsedEmail $mail): ?string
    {
        $subject = $this->fromSubject($mail->subject);
        $body = $this->fromBody($mail);

        if ($subject !== null) {
            // A body that names a DIFFERENT code is not something to guess between.
            return $body !== null && $body !== $subject ? null : $subject;
        }

        return $body;
    }

    private function fromSubject(string $subject): ?string
    {
        $clean = $this->clean($subject);

        return preg_match('/Do not share:\s*(\d{4})(?!\d)/i', $clean, $m) === 1 ? $m[1] : null;
    }

    private function fromBody(ParsedEmail $mail): ?string
    {
        $text = $this->clean($mail->text !== '' ? $mail->text : $this->htmlToText($mail->html));
        foreach (['/enter this verification code\s*:?/i', '/verification code\s*:?/i'] as $anchor) {
            $found = $this->codesAfter($text, $anchor);
            if ($found !== []) {
                return count($found) === 1 ? $found[0] : null; // several different codes = ambiguous
            }
        }

        return null;
    }

    /** @return list<string> distinct standalone 4-digit tokens shortly after each match of the anchor */
    private function codesAfter(string $text, string $anchor): array
    {
        $codes = [];
        if (preg_match_all($anchor, $text, $matches, PREG_OFFSET_CAPTURE) === 0) {
            return [];
        }
        foreach ($matches[0] as [$phrase, $offset]) {
            $tail = substr($text, $offset + strlen($phrase), self::WINDOW);
            if (preg_match('/(?<!\d)(\d{4})(?!\d)/', $tail, $m) === 1) {
                $codes[$m[1]] = true;
            }
        }

        return array_map('strval', array_keys($codes));
    }

    private function htmlToText(string $html): string
    {
        $html = (string) preg_replace('/<(script|style)\b.*?<\/\1>/is', ' ', $html);
        $html = (string) preg_replace('/<\/(td|tr|p|div|br|h\d)>|<br\s*\/?>/i', "\n", $html);

        return html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    private function clean(string $text): string
    {
        return (string) preg_replace(self::INVISIBLE, '', $text);
    }
}
