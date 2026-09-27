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

    /**
     * Memo of the centroid grid for {@see nearest()} — for the rest of this PHP
     * request (under FPM a static lives one request, not the whole process), so a
     * map poll reads the cached blob once instead of once per driver/waypoint.
     *
     * @var array<string, array<int, array{plz: string, city: string, lat: float, lng: float}>>|null
     */
    private static ?array $grid = null;

    /** Grid cell size in degrees (≈11 × 7 km in Germany). */
    private const CELL = 0.1;

    /** Rings searched around a point before falling back to a full scan (≈1.5°). */
    private const MAX_RING = 15;

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
     * Whether a name is a known German town (case-insensitive exact match against
     * the postal-code table). Used to validate a town parsed out of free text
     * before trusting it — so a street word is never mistaken for a city.
     */
    public static function hasCity(string $name): bool
    {
        $name = mb_strtolower(trim($name));
        if ($name === '') {
            return false;
        }

        return Cache::remember("plz:cityknown:v1:{$name}", self::TTL, function () use ($name) {
            return DB::table('postal_codes')->whereRaw('LOWER(city) = ?', [$name])->exists();
        });
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
        // A redacted 0,0 (or any fix far outside the region) has no meaningful town.
        if ($lat < 44.0 || $lat > 57.0 || $lng < 3.0 || $lng > 18.0) {
            return null;
        }

        $grid = self::grid();
        if ($grid === []) {
            return null;
        }

        // Search the point's cell, then widening rings of cells — tens of distance
        // checks instead of all ~8k per point. Every cell of ring k+1 is at least
        // k cells away, so once that bound exceeds the best distance found, no
        // further ring can hold a nearer centroid: the result equals a full scan.
        [$cy, $cx] = self::cellOf($lat, $lng);
        $best = null;
        $bestD = INF;
        for ($ring = 0; $ring <= self::MAX_RING; $ring++) {
            foreach (self::ringCells($cy, $cx, $ring) as $key) {
                foreach ($grid[$key] ?? [] as $row) {
                    $d = ($row['lat'] - $lat) ** 2 + ($row['lng'] - $lng) ** 2;
                    if ($d < $bestD) {
                        $bestD = $d;
                        $best = $row;
                    }
                }
            }
            if ($best !== null && ($ring * self::CELL) ** 2 > $bestD) {
                break;
            }
        }

        return $best !== null ? ['plz' => $best['plz'], 'city' => $best['city']] : null;
    }

    /**
     * The centroid table bucketed into CELL-degree cells, built once and cached.
     *
     * @return array<string, array<int, array{plz: string, city: string, lat: float, lng: float}>>
     */
    private static function grid(): array
    {
        return self::$grid ??= Cache::remember('plz:grid:v1', self::TTL, function () {
            $grid = [];
            foreach (DB::table('postal_codes')->get(['plz', 'city', 'lat', 'lng']) as $r) {
                $row = ['plz' => (string) $r->plz, 'city' => (string) $r->city, 'lat' => (float) $r->lat, 'lng' => (float) $r->lng];
                [$cy, $cx] = self::cellOf($row['lat'], $row['lng']);
                $grid[$cy.':'.$cx][] = $row;
            }

            return $grid;
        });
    }

    /** @return array{0: int, 1: int} */
    private static function cellOf(float $lat, float $lng): array
    {
        return [(int) floor($lat / self::CELL), (int) floor($lng / self::CELL)];
    }

    /**
     * Keys of the cells on the square ring at Chebyshev distance $ring.
     *
     * @return array<int, string>
     */
    private static function ringCells(int $cy, int $cx, int $ring): array
    {
        if ($ring === 0) {
            return [$cy.':'.$cx];
        }

        $keys = [];
        for ($dy = -$ring; $dy <= $ring; $dy++) {
            for ($dx = -$ring; $dx <= $ring; $dx++) {
                if (max(abs($dy), abs($dx)) === $ring) {
                    $keys[] = ($cy + $dy).':'.($cx + $dx);
                }
            }
        }

        return $keys;
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
