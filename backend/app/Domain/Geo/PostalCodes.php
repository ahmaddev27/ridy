<?php

namespace App\Domain\Geo;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * O(1), network-free lookups against the static German postal-code table:
 * a PLZ → its town centroid and authoritative city name. The safety net for
 * address resolution — any offer carrying a valid PLZ can always resolve to at
 * least the town centre, and its city can be corrected deterministically
 * (PLZ ↔ city is 1:1 in Germany). See docs/address-resolution-plan.md.
 */
class PostalCodes
{
    private const CSV = __DIR__.'/../../../database/data/postal_codes.csv';

    /** Per-PLZ row cache TTL — the table is static, so cache for a day. */
    private const TTL = 86400;

    /** Normalize free input to a 5-digit PLZ, or null when it isn't one. */
    public static function normalize(?string $plz): ?string
    {
        $plz = trim((string) $plz);

        return preg_match('/^\d{5}$/', $plz) === 1 ? $plz : null;
    }

    /**
     * The town centroid for a PLZ, or null when unknown.
     *
     * @return array{lat: float, lng: float}|null
     */
    public static function centroid(string $plz): ?array
    {
        $row = self::row($plz);

        return $row !== null ? ['lat' => (float) $row->lat, 'lng' => (float) $row->lng] : null;
    }

    /** The authoritative city name for a PLZ, or null when unknown. */
    public static function city(string $plz): ?string
    {
        return self::row($plz)?->city;
    }

    /** Cached single-row lookup (returns null and caches the miss too). */
    private static function row(string $plz): ?object
    {
        $key = self::normalize($plz);
        if ($key === null) {
            return null;
        }

        $row = Cache::remember("plz:{$key}", self::TTL, function () use ($key) {
            return DB::table('postal_codes')->where('plz', $key)->first(['city', 'lat', 'lng']) ?? false;
        });

        return $row === false ? null : $row;
    }

    /**
     * Import (idempotent upsert) the postal-code CSV into the table. Shared by the
     * seeder and the deploy-time data migration so production is populated by
     * `migrate --force` and local by `db:seed` alike. Returns the row count.
     */
    public static function import(): int
    {
        $handle = fopen(self::CSV, 'r');
        if ($handle === false) {
            return 0;
        }

        fgetcsv($handle); // header

        $rows = [];
        $imported = 0;
        $flush = function () use (&$rows, &$imported) {
            if ($rows === []) {
                return;
            }
            DB::table('postal_codes')->upsert($rows, ['plz'], ['city', 'lat', 'lng', 'bundesland']);
            $imported += count($rows);
            $rows = [];
        };

        while (($cols = fgetcsv($handle)) !== false) {
            [$plz, $city, $lat, $lng] = array_pad($cols, 4, null);
            if (self::normalize($plz) === null || ! is_numeric($lat) || ! is_numeric($lng)) {
                continue;
            }
            $rows[] = ['plz' => $plz, 'city' => (string) $city, 'lat' => (float) $lat, 'lng' => (float) $lng, 'bundesland' => null];
            if (count($rows) >= 1000) {
                $flush();
            }
        }
        $flush();
        fclose($handle);

        return $imported;
    }
}
