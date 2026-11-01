<?php

namespace App\Domain\Dispatch\Inbound;

/**
 * A small RFC 5322 / MIME reader: headers, the decoded Subject, and the text/plain and
 * text/html bodies (multipart, quoted-printable, base64, charsets, forwarded
 * message/rfc822). Attachments are ignored. Pure and in-memory - nothing is written anywhere.
 */
class MimeParser
{
    private const MAX_DEPTH = 5;

    /** Never throws: malformed input yields whatever could be read (or an empty message). */
    public function parse(string $raw): ParsedEmail
    {
        $headers = [];
        $parts = ['text' => '', 'html' => ''];
        $subject = '';
        try {
            [$headers, $body] = $this->split($raw);
            $this->collect($headers, $body, $parts, 0);
            $subject = $this->decodeHeader($headers['subject'][0] ?? '');
        } catch (\Throwable) {
            // junk mail is the sender's problem, not an infrastructure failure
        }

        return new ParsedEmail($headers, $subject, $parts['text'], $parts['html']);
    }

    /** @return array{0: array<string, list<string>>, 1: string} */
    private function split(string $raw): array
    {
        $raw = str_replace("\r\n", "\n", $raw);
        $pos = strpos($raw, "\n\n");
        $head = $pos === false ? $raw : substr($raw, 0, $pos);
        $body = $pos === false ? '' : substr($raw, $pos + 2);

        return [$this->parseHeaders($head), $body];
    }

    /** @return array<string, list<string>> */
    private function parseHeaders(string $block): array
    {
        $headers = [];
        $current = null;
        foreach (explode("\n", $block) as $line) {
            if ($line !== '' && ($line[0] === ' ' || $line[0] === "\t") && $current !== null) {
                $last = array_key_last($headers[$current]);
                $headers[$current][$last] .= ' '.trim($line);

                continue;
            }
            $colon = strpos($line, ':');
            if ($colon === false || $colon === 0) {
                continue;
            }
            $current = strtolower(trim(substr($line, 0, $colon)));
            $headers[$current][] = trim(substr($line, $colon + 1));
        }

        return $headers;
    }

    /**
     * @param  array<string, list<string>>  $headers
     * @param  array{text: string, html: string}  $parts
     */
    private function collect(array $headers, string $body, array &$parts, int $depth): void
    {
        if ($depth > self::MAX_DEPTH) {
            return;
        }
        $type = strtolower($this->param($headers['content-type'][0] ?? 'text/plain', null));

        if (str_starts_with($type, 'multipart/')) {
            $boundary = $this->param($headers['content-type'][0] ?? '', 'boundary');
            foreach ($boundary === '' ? [] : $this->splitMultipart($body, $boundary) as $part) {
                [$h, $b] = $this->split($part);
                $this->collect($h, $b, $parts, $depth + 1);
            }

            return;
        }
        if ($type === 'message/rfc822') {
            [$h, $b] = $this->split($body);
            $this->collect($h, $b, $parts, $depth + 1);

            return;
        }
        if (! in_array($type, ['text/plain', 'text/html'], true)) {
            return;
        }
        $slot = $type === 'text/html' ? 'html' : 'text';
        $parts[$slot] .= $this->decodeBody($headers, $body);
    }

    /** @return list<string> */
    private function splitMultipart(string $body, string $boundary): array
    {
        $chunks = explode('--'.$boundary, $body);
        array_shift($chunks); // preamble
        $parts = [];
        foreach ($chunks as $chunk) {
            if (str_starts_with($chunk, '--')) {
                break; // closing delimiter
            }
            $parts[] = ltrim($chunk, "\n");
        }

        return $parts;
    }

    /** @param  array<string, list<string>>  $headers */
    private function decodeBody(array $headers, string $body): string
    {
        $encoding = strtolower(trim($headers['content-transfer-encoding'][0] ?? '7bit'));
        $decoded = match ($encoding) {
            'quoted-printable' => quoted_printable_decode($body),
            'base64' => (string) base64_decode(preg_replace('/\s+/', '', $body) ?? '', false),
            default => $body,
        };
        $charset = strtolower($this->param($headers['content-type'][0] ?? '', 'charset'));
        if ($charset !== '' && $charset !== 'utf-8' && $charset !== 'us-ascii' && $this->knownCharset($charset)) {
            try {
                $decoded = mb_convert_encoding($decoded, 'UTF-8', $charset);
            } catch (\ValueError) {
                // keep the bytes as they are
            }
        }

        return $decoded;
    }

    /**
     * An unrecognised charset must not make the whole message unreadable: PHP 8 throws a
     * ValueError for it (the @ operator does not stop that), so it is checked up front.
     */
    private function knownCharset(string $charset): bool
    {
        static $known = null;
        $known ??= array_map('strtolower', mb_list_encodings());
        if (in_array($charset, $known, true)) {
            return true;
        }
        try {
            return mb_encoding_aliases($charset) !== [] || in_array(strtolower(mb_preferred_mime_name($charset) ?: ''), $known, true);
        } catch (\ValueError) {
            return false;
        }
    }

    /** The bare media type when $name is null, else that parameter's value. */
    private function param(string $header, ?string $name): string
    {
        if ($name === null) {
            return trim(explode(';', $header)[0]);
        }
        if (preg_match('/;\s*'.preg_quote($name, '/').'\s*=\s*(?:"([^"]*)"|([^\s;]+))/i', $header, $m) !== 1) {
            return '';
        }

        return $m[1] !== '' ? $m[1] : ($m[2] ?? '');
    }

    private function decodeHeader(string $value): string
    {
        $decoded = @mb_decode_mimeheader($value);

        return is_string($decoded) ? $decoded : $value;
    }
}
