<?php

namespace App\Domain\Fleet\Earnings;

/**
 * One earner's classified figures, in integer E5. {@see money()} is the only
 * place a figure becomes text, and it is text on purpose: El-Professor's
 * display parser reads "1.234" as 1.23, so a JSON number is a figure that can
 * be wrong by a factor of a thousand.
 */
final class EarnerFigures
{
    public function __construct(
        public readonly int $fare,
        public readonly int $promotion,
        public readonly int $tips,
        public readonly int $cash,
        public readonly int $netOutstanding,
        public readonly ?int $trips,
        public readonly ?string $currency,
    ) {}

    /** What the pieces add up to, before comparing with what Uber says is outstanding. */
    public function computed(): int
    {
        return $this->fare + $this->promotion + $this->tips - $this->cash;
    }

    /** Computed minus actual, signed. Subtracted in E5 and rounded once, at the edge. */
    public function difference(): int
    {
        return $this->computed() - $this->netOutstanding;
    }

    /** E5 to "123.45": a dot, exactly two places, half away from zero, never a float. */
    public static function money(int $e5): string
    {
        $cents = intdiv(abs($e5) + 500, 1000);
        $text = intdiv($cents, 100).'.'.str_pad((string) ($cents % 100), 2, '0', STR_PAD_LEFT);

        return ($e5 < 0 && $cents !== 0 ? '-' : '').$text;
    }
}
