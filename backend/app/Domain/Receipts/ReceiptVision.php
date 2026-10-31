<?php

namespace App\Domain\Receipts;

use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Reads a receipt photo with the self-hosted vision model (llama.cpp serving
 * Qwen2.5-VL-3B, internal network only) and returns sanitised receipt fields.
 *
 * The image is downscaled first (a receipt needs ~1000px, and CPU inference
 * time scales with image tokens), sent inline as a data URI, and never
 * written anywhere by this class. The caller owns deleting the source file.
 *
 * The two failure modes seen in validation are closed here, not hoped away:
 * - runaway key repetition -> `response_format: json_object`, temperature 0
 *   and a small `max_tokens`, so ONE object is emitted and generation stops;
 * - units/labels inside values -> the prompt demands bare numbers and
 *   {@see ReceiptVisionSanitizer} strips whatever slips through.
 */
class ReceiptVision
{
    private const PROMPT = <<<'TXT'
You read German fuel-station receipts. Return ONE JSON object with exactly these keys
(use null when a field is truly absent):
station_name, street, postal_code, city, date, time, liters, price_per_liter, total_amount,
receipt_number, station_number.
Rules: date as YYYY-MM-DD; time as HH:MM (24h, the SALE time, not the TSE UTC timestamp).
liters, price_per_liter and total_amount are plain decimal numbers with a dot (21.94, 2.279, 50.00):
NO currency, NO unit, NO label, NO thousands separator. total_amount is the gross amount paid
(Brutto / Summe / Betrag), not the net. Read digits exactly as printed; do not compute or correct them.
TXT;

    public function __construct(private readonly ReceiptVisionSanitizer $sanitizer) {}

    public function isConfigured(): bool
    {
        return (string) config('services.receipt_vision.url') !== '';
    }

    /**
     * @return array<string, mixed> sanitised fields
     *
     * @throws RuntimeException when the model is unreachable, errors or returns no JSON
     */
    public function read(string $imageBytes): array
    {
        $jpeg = $this->downscale($imageBytes);
        $content = $this->ask($jpeg);

        return $this->sanitizer->sanitize($this->decode($content));
    }

    /** Longest side to `max_edge`, JPEG q80; never enlarges. */
    public function downscale(string $bytes): string
    {
        $image = @imagecreatefromstring($bytes);
        if ($image === false) {
            throw new RuntimeException('Not a readable image.');
        }
        $edge = (int) config('services.receipt_vision.max_edge', 1000);
        $longest = max(imagesx($image), imagesy($image));
        if ($longest > $edge) {
            $scaled = imagescale($image, (int) round(imagesx($image) * $edge / $longest));
            $image = $scaled !== false ? $scaled : $image;
        }
        ob_start();
        imagejpeg($image, null, 80);

        return (string) ob_get_clean();
    }

    private function ask(string $jpeg): string
    {
        $response = Http::timeout((int) config('services.receipt_vision.timeout', 240))
            ->acceptJson()
            ->post(config('services.receipt_vision.url').'/v1/chat/completions', [
                'model' => 'qwen2.5-vl',
                'temperature' => 0,
                'max_tokens' => 512,
                'response_format' => ['type' => 'json_object'],
                'messages' => [[
                    'role' => 'user',
                    'content' => [
                        ['type' => 'text', 'text' => self::PROMPT],
                        ['type' => 'image_url', 'image_url' => ['url' => 'data:image/jpeg;base64,'.base64_encode($jpeg)]],
                    ],
                ]],
            ]);

        if ($response->failed()) {
            throw new RuntimeException('Vision server answered '.$response->status());
        }

        return (string) $response->json('choices.0.message.content', '');
    }

    /** @return array<string, mixed> */
    private function decode(string $content): array
    {
        $data = json_decode(trim($content), true);
        if (! is_array($data) && preg_match('/\{.*\}/s', $content, $m) === 1) {
            $data = json_decode($m[0], true);
        }
        if (! is_array($data)) {
            throw new RuntimeException('Vision server returned no JSON object.');
        }

        return $data;
    }
}
