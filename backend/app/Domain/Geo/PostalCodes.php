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

        return $row !== null ? ['lat' => $row['lat'], 'lng' => $row['lng']] : null;
    }

    /** The authoritative city name for a PLZ, or null when unknown. */
    public static function city(string $plz): ?string
    {
        return self::row($plz)['city'] ?? null;
    }

    /**
     * The nearest town to a coordinate — {plz, city} — for a live "current city"
     * label from a driver's GPS. Network-free: scans the cached centroid table by
     * squared distance (exact enough for the nearest within a small country).
     *
     * @return array{plz: string, city: string}|null
     */
    public static function nearest(float $lat, float $lng): ?array
    {
        $all = Cache::remember('plz:all:v1', self::TTL, function () {
            return DB::table('postal_codes')->get(['plz', 'city', 'lat', 'lng'])
                ->map(fn ($r) => ['plz' => $r->plz, 'city' => $r->city, 'lat' => (float) $r->lat, 'lng' => (float) $r->lng])
                ->all();
        });

        $best = null;
        $bestD = INF;
        foreach ($all as $row) {
            $d = ($row['lat'] - $lat) ** 2 + ($row['lng'] - $lng) ** 2;
            if ($d < $bestD) {
                $bestD = $d;
                $best = $row;
            }
        }

        return $best !== null ? ['plz' => $best['plz'], 'city' => $best['city']] : null;
    }

    /**
     * Cached single-row lookup as a plain array (returns null and caches the miss
     * too). A plain array is cached — never the query builder's stdClass, which
     * deserializes to an "incomplete object" under some cache stores.
     *
     * @return array{city: string, lat: float, lng: float}|null
     */
    private static function row(string $plz): ?array
    {
        $key = self::normalize($plz);
        if ($key === null) {
            return null;
        }

        // Key is versioned (v2) so any previously-cached stdClass rows from the
        // earlier object-caching bug are ignored rather than re-read as arrays.
        $row = Cache::remember("plz:v2:{$key}", self::TTL, function () use ($key) {
            $r = DB::table('postal_codes')->where('plz', $key)->first(['city', 'lat', 'lng']);

            return $r === null ? false : ['city' => (string) $r->city, 'lat' => (float) $r->lat, 'lng' => (float) $r->lng];
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

        fgetcsv($handle, null, ',', '"', ''); // header — explicit $escape (PHP 8.4+)

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

        while (($cols = fgetcsv($handle, null, ',', '"', '')) !== false) {
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
