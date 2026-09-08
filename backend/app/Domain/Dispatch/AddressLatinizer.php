<?php

namespace App\Domain\Dispatch;

use App\Domain\Geo\PostalCodes;

/**
 * Guarantees a Latin, driver-readable address. Uber localizes an offer's address
 * TEXT to the RIDER's app language, so a Chinese / Japanese / Arabic / Cyrillic /
 * Devanagari rider yields an unreadable string ("德国伍珀塔尔邮政编码: 42103",
 * "ドイツ 〒42781 ハーン"). A Latin value passes through untouched; a non-Latin one is
 * replaced with the authoritative German "<PLZ> City" from the always-Latin postcode
 * inside it (PLZ↔city is 1:1 in Germany, so this is a correction, not a guess), or
 * blanked (null) when it carries no usable postcode — a driver must never be shown a
 * foreign address. Script-agnostic: the check is "any non-Latin letter", so every
 * writing system is covered, not a hand-listed set of languages.
 *
 * The single source of truth for this rule, shared by every surface that shows an
 * address to a driver (the offer push notifier and the API resource) so they can
 * never disagree.
 */
class AddressLatinizer
{
    /**
     * @param  ?string  $display  the already-resolved display value (preferred), or null
     * @param  mixed  $raw  the raw supplier address to fall back to when no display exists
     */
    public static function toLatin(?string $display, mixed $raw = null): ?string
    {
        $value = $display ?? AddressFormatter::tidy(is_string($raw) ? $raw : null);
        if ($value === null || ! AddressNormalizer::hasNonLatinLetters($value)) {
            return $value;
        }

        return preg_match('/\b(\d{5})\b/', $value, $m) === 1 && ($city = PostalCodes::city($m[1])) !== null
            ? $m[1].' '.$city
            : null;
    }
}
