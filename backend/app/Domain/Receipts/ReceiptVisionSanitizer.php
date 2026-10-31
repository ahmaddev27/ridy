<?php

namespace App\Domain\Receipts;

use App\Domain\Geo\PostalCodes;
use Carbon\CarbonImmutable;

/**
 * Turns the vision model's raw JSON into the receipt fields the driver app
 * uses - numbers as numbers, nothing carrying a unit or a label.
 *
 * The model is a 3B reader, not an oracle: it returned "2.279 EUR/1" for a
 * price and "42.02 ... BRUTTO" for a net amount. Everything here is therefore
 * defensive and ABSTAINS (null) rather than guesses; the app's retake gate
 * treats a null as "not read".
 */
class ReceiptVisionSanitizer
{
    /** Largest believable receipt, in euros / litres. */
    private const MAX_TOTAL = 1000.0;

    private const MAX_LITRES = 200.0;

    /** Per-litre price band for German pumps (EUR). */
    private const PPL_MIN = 0.5;

    private const PPL_MAX = 4.0;

    /**
     * @param  array<string, mixed>  $raw
     * @return array<string, mixed>
     */
    public function sanitize(array $raw, ?CarbonImmutable $today = null): array
    {
        $today ??= CarbonImmutable::now('Europe/Berlin');
        $fuel = $this->fuelFigures($raw);
        $plz = PostalCodes::normalize($this->text($raw['postal_code'] ?? null));
        $authoritative = $plz !== null ? PostalCodes::city($plz) : null;

        return [
            'merchant_name' => $this->text($raw['station_name'] ?? null),
            'street' => $this->text($raw['street'] ?? null),
            'postal_code' => $plz,
            'city' => $authoritative ?? $this->text($raw['city'] ?? null),
            'city_from_plz' => $authoritative !== null,
            'date' => $this->date($raw['date'] ?? null, $today),
            'time' => $this->time($raw['time'] ?? null),
            'amount' => $fuel['amount'],
            'litres' => $fuel['litres'],
            'price_per_litre' => $fuel['price_per_litre'],
            'category' => ($fuel['litres'] !== null || $fuel['price_per_litre'] !== null) ? 'Tanken' : null,
            'receipt_number' => $this->text($raw['receipt_number'] ?? null, 40),
            'station_number' => $this->text($raw['station_number'] ?? null, 40),
            'warnings' => $fuel['warnings'],
        ];
    }

    /**
     * Total, litres and price per litre, cross-checked: litres x price must
     * land on the total. If it does not, one of the three is misread and we
     * cannot tell which, so the fuel line is dropped (the app asks for a retake).
     *
     * @param  array<string, mixed>  $raw
     * @return array{amount: ?float, litres: ?float, price_per_litre: ?float, warnings: list<string>}
     */
    private function fuelFigures(array $raw): array
    {
        $amount = $this->number($raw['total_amount'] ?? null, 0.01, self::MAX_TOTAL);
        $litres = $this->number($raw['liters'] ?? null, 0.01, self::MAX_LITRES);
        $ppl = $this->number($raw['price_per_liter'] ?? null, self::PPL_MIN, self::PPL_MAX);
        $warnings = [];

        if ($amount !== null && $litres !== null && $ppl !== null) {
            $tolerance = max(0.15, $amount * 0.015);
            if (abs($litres * $ppl - $amount) > $tolerance) {
                $litres = $ppl = null;
                $warnings[] = 'fuel_math';
            }
        }

        return ['amount' => $amount, 'litres' => $litres, 'price_per_litre' => $ppl, 'warnings' => $warnings];
    }

    /** First decimal number in a value, ignoring units/labels; null if none or out of range. */
    public function number(mixed $value, float $min, float $max): ?float
    {
        if (is_int($value) || is_float($value)) {
            $n = (float) $value;
        } elseif (is_string($value) && preg_match('/\d{1,3}(?:\.\d{3})+,\d+|\d+(?:[.,]\d+)?/', $value, $m) === 1) {
            $token = $m[0];
            $token = str_contains($token, ',') ? str_replace(['.', ','], ['', '.'], $token) : $token;
            $n = (float) $token;
        } else {
            return null;
        }

        return ($n >= $min && $n <= $max) ? round($n, 3) : null;
    }

    private function text(mixed $value, int $max = 120): ?string
    {
        if (! is_string($value) && ! is_int($value)) {
            return null;
        }
        $text = trim(preg_replace('/\s+/', ' ', (string) $value) ?? '');

        return ($text === '' || strtolower($text) === 'null') ? null : mb_substr($text, 0, $max);
    }

    /** ISO (or German dd.mm.yyyy) date within the last 400 days, not in the future; else null. */
    private function date(mixed $value, CarbonImmutable $today): ?string
    {
        $text = $this->text($value);
        if ($text === null) {
            return null;
        }
        $format = preg_match('/^\d{2}\.\d{2}\.\d{4}$/', $text) === 1 ? 'd.m.Y' : 'Y-m-d';
        $date = CarbonImmutable::createFromFormat('!'.$format, $text, 'Europe/Berlin');
        if ($date === false || $date->format($format) !== $text) {
            return null;
        }
        if ($date->isAfter($today->addDay()) || $date->isBefore($today->subDays(400))) {
            return null;
        }

        return $date->toDateString();
    }

    private function time(mixed $value): ?string
    {
        $text = $this->text($value);
        if ($text === null || preg_match('/^([01]?\d|2[0-3]):([0-5]\d)/', $text, $m) !== 1) {
            return null;
        }

        return sprintf('%02d:%s', (int) $m[1], $m[2]);
    }
}
