<?php

namespace App\Console\Commands;

use App\Domain\Geo\Models\RailwayStation;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use XMLReader;

/**
 * Imports German railway-station addresses from the DB InfraGO OpenStation NeTEx
 * dataset into `railway_stations`, so StationResolver can turn a street-less
 * "PLZ City" pickup into the station's real address with a purely-local lookup.
 *
 * The published bundle is a ~18 MB gzip wrapping a single ~300 MB NeTEx XML, so
 * we stream it with XMLReader (constant memory) over the gzip wrapper and upsert
 * one StopPlace at a time keyed on its stable DHID. The live table is only
 * touched on a successful parse — a failed download/parse leaves the current
 * data intact (never wipe-then-fail).
 */
class SyncRailwayStations extends Command
{
    protected $signature = 'stations:sync {--url=https://bahnhof.de/daten/netex} {--file= : Use an already-downloaded .gz instead of fetching}';

    protected $description = 'Import DB InfraGO OpenStation railway-station addresses (local, indexed).';

    public function handle(): int
    {
        $path = $this->option('file') ?: $this->download((string) $this->option('url'));
        if ($path === null) {
            $this->error('Download failed — existing station data left untouched.');

            return self::FAILURE;
        }

        $reader = new XMLReader;
        if (! @$reader->open('compress.zlib://'.$path)) {
            $this->error("Could not open NeTEx stream at {$path}.");

            return self::FAILURE;
        }

        $imported = 0;
        $withCoords = 0;
        $withHouseNo = 0;

        while ($reader->read()) {
            if ($reader->nodeType !== XMLReader::ELEMENT || $reader->localName !== 'StopPlace') {
                continue;
            }

            $row = $this->parseStopPlace((string) $reader->readOuterXml());
            $reader->next(); // skip the subtree we just consumed

            if ($row === null) {
                continue;
            }

            RailwayStation::query()->updateOrCreate(['dhid' => $row['dhid']], $row);
            $imported++;
            $withCoords += $row['latitude'] !== null ? 1 : 0;
            $withHouseNo += $row['house_number'] !== null ? 1 : 0;

            if ($imported % 1000 === 0) {
                $this->info("… {$imported} stations");
            }
        }
        $reader->close();

        $pctCoords = $imported > 0 ? round($withCoords / $imported * 100) : 0;
        $pctHouse = $imported > 0 ? round($withHouseNo / $imported * 100) : 0;
        $this->info("Imported {$imported} stations — {$pctCoords}% with coordinates, {$pctHouse}% with a house number.");

        return self::SUCCESS;
    }

    /** Fetch the bundle to a temp file (follows redirects); null on any failure. */
    private function download(string $url): ?string
    {
        $path = storage_path('app/netex-openstation.gz');
        try {
            $ok = Http::withHeaders(['User-Agent' => 'Mozilla/5.0 (Reidey station sync)'])
                ->timeout(600)
                ->sink($path)
                ->get($url)
                ->successful();
        } catch (\Throwable $e) {
            $this->error('Download error: '.$e->getMessage());

            return null;
        }

        return $ok && is_file($path) && filesize($path) > 0 ? $path : null;
    }

    /**
     * Extract one station from a NeTEx <StopPlace> fragment. The structure is
     * flat and namespaced; targeted regex over the small fragment is robust and
     * namespace-agnostic (no per-node SimpleXML namespace juggling). Returns null
     * when the mandatory identity/postcode are missing — we never store a partial
     * station that a lookup couldn't trust.
     *
     * @return array<string, mixed>|null
     */
    private function parseStopPlace(string $xml): ?array
    {
        $dhid = $this->attr($xml, 'id');
        $postcode = $this->tag($xml, 'PostCode');
        if ($dhid === null || $postcode === null || ! preg_match('/^\d{5}$/', $postcode)) {
            return null;
        }

        $streetLine = $this->tag($xml, 'Street');
        [$street, $house] = $this->splitStreet($streetLine);
        $city = $this->tag($xml, 'Town');

        return [
            'dhid' => $dhid,
            'eva' => $this->keyValue($xml, 'EVA'),
            'ds100' => $this->keyValue($xml, 'RIL'),
            'stada' => $this->stada($xml),
            'category' => $this->keyValue($xml, 'DBINFRAGO_STATION_CATEGORY'),
            'name' => $this->tag($xml, 'Name') ?? 'Bahnhof',
            'street_line' => $streetLine,
            'street' => $street,
            'house_number' => $house,
            'postal_code' => $postcode,
            'city' => $city,
            'normalized_city' => $city !== null ? RailwayStation::normalizeCity($city) : null,
            'latitude' => $this->floatTag($xml, 'Latitude'),
            'longitude' => $this->floatTag($xml, 'Longitude'),
            'source' => 'DB InfraGO OpenStation',
        ];
    }

    /** "Europaplatz 1" → ["Europaplatz", "1"]; "Bahnhofstraße" → ["Bahnhofstraße", null]. */
    private function splitStreet(?string $line): array
    {
        $line = trim((string) $line);
        if ($line === '') {
            return [null, null];
        }
        // Trailing house number: digits (+ optional letter, or a "2-4" range).
        if (preg_match('/^(.*?[^\s.])[\s.]*(\d+\s*[a-zA-Z]?(?:\s*-\s*\d+[a-zA-Z]?)?)$/u', $line, $m) === 1) {
            return [trim($m[1]), trim($m[2])];
        }

        return [$line, null];
    }

    private function attr(string $xml, string $name): ?string
    {
        return preg_match('/\b'.$name.'="([^"]+)"/', $xml, $m) === 1 ? $this->clean($m[1]) : null;
    }

    /** First text of a (possibly attribute-bearing) element, before any nested tag. */
    private function tag(string $xml, string $name): ?string
    {
        return preg_match('/<'.$name.'\b[^>]*>([^<]+)/', $xml, $m) === 1 ? $this->clean($m[1]) : null;
    }

    private function floatTag(string $xml, string $name): ?float
    {
        $v = $this->tag($xml, $name);

        return $v !== null && is_numeric($v) ? (float) $v : null;
    }

    /** <KeyValue><Key>NAME</Key><Value>…</Value></KeyValue> lookup. */
    private function keyValue(string $xml, string $key): ?string
    {
        $pattern = '/<Key>'.preg_quote($key, '/').'<\/Key>\s*<Value>([^<]*)<\/Value>/';

        return preg_match($pattern, $xml, $m) === 1 ? ($this->clean($m[1]) ?: null) : null;
    }

    /** STADA number lives in a PrivateCode tagged with the stada namespace. */
    private function stada(string $xml): ?string
    {
        return preg_match('/<PrivateCode[^>]*stada[^>]*>([^<]+)/', $xml, $m) === 1 ? $this->clean($m[1]) : null;
    }

    private function clean(string $value): string
    {
        return trim(html_entity_decode($value, ENT_QUOTES | ENT_XML1, 'UTF-8'));
    }
}
