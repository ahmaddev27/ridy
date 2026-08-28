<?php

namespace App\Domain\Geo\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A German railway station imported from DB InfraGO OpenStation. Read-mostly:
 * written only by the sync command, read on the hot path by StationResolver.
 *
 * @property string $dhid
 * @property string $name
 * @property string|null $street_line
 * @property string|null $street
 * @property string|null $house_number
 * @property string|null $postal_code
 * @property string|null $city
 * @property string|null $normalized_city
 * @property float|null $latitude
 * @property float|null $longitude
 */
class RailwayStation extends Model
{
    protected $guarded = [];

    protected $casts = [
        'latitude' => 'float',
        'longitude' => 'float',
    ];

    /**
     * Fold a city name to a script-stable lookup key: lowercase, trimmed, spaces
     * collapsed, and German umlauts expanded (ä→ae, ö→oe, ü→ue, ß→ss) so
     * "München" and "Muenchen" resolve to the same station. Display keeps the
     * original casing; only the lookup uses this. Used by both the importer (to
     * fill normalized_city) and the resolver (to build the query key) so they
     * always agree.
     */
    public static function normalizeCity(?string $city): string
    {
        $city = mb_strtolower(trim((string) $city));
        $city = strtr($city, ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);
        // Drop a parenthetical qualifier — "Wünschendorf (Elster)" → "wuenschendorf".
        $city = (string) preg_replace('/\s*\([^)]*\)/', '', $city);

        return trim((string) preg_replace('/\s+/', ' ', $city));
    }
}
