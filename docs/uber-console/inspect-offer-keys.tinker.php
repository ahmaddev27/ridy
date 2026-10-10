// Answers the two code-blocking questions over REAL production traffic, read-only.
//   1. Does a RAMEN offer ever carry `offerType`? (RejectOffers needs it; the repo
//      has zero occurrences and our only capture used "JOB")
//   2. Is `realOfferUUID` always present? (the mutation needs it; the column is
//      written at DispatchOfferIngestor.php:103 and read nowhere, so prod has
//      never exercised it)
//
// dispatch_network_logs.payload holds ONE raw offer exactly as the supplier sent it,
// pre-ingest and pre-geocode (SupplierNetworkRecorder::offer, :126-152).
//
// Run on the prod box:
//   docker exec -it ridy-backend-1 php artisan tinker
// then paste everything below.

$rows = DB::table('dispatch_network_logs')
    ->where('kind', 'offer')
    ->orderByDesc('id')
    ->limit(5000)
    ->pluck('payload');

$keys = [];        // key => how many offers carried it
$types = [];       // offerType value => count
$noReal = 0;       // offers with no realOfferUUID
$noWindow = 0;     // offers with no acceptWindowInSeconds
$windows = [];     // acceptWindowInSeconds value => count
$typeish = [];     // any key that looks like a type/kind/product
$n = 0;

foreach ($rows as $raw) {
    $o = json_decode($raw, true);
    if (! is_array($o) || ! isset($o['offerUUID'])) {
        continue;
    }
    $n++;

    foreach (array_keys($o) as $k) {
        $keys[$k] = ($keys[$k] ?? 0) + 1;
        if (preg_match('/type|kind|product|flow|category/i', $k)) {
            $v = $o[$k];
            $typeish["$k"][is_scalar($v) ? (string) $v : '(non-scalar)'] = true;
        }
    }

    $t = array_key_exists('offerType', $o) ? $o['offerType'] : '(ABSENT)';
    $tk = is_scalar($t) ? (string) $t : '(non-scalar)';
    $types[$tk] = ($types[$tk] ?? 0) + 1;

    if (empty($o['realOfferUUID'])) {
        $noReal++;
    }

    $w = $o['acceptWindowInSeconds'] ?? null;
    if ($w === null) {
        $noWindow++;
    } else {
        $wk = (string) $w;
        $windows[$wk] = ($windows[$wk] ?? 0) + 1;
    }
}

arsort($keys);
echo "offers inspected: $n\n\n";
echo "=== offerType ===\n";
print_r($types);
echo "\n=== any type-ish key ===\n";
print_r($typeish);
echo "\n=== realOfferUUID MISSING on: $noReal of $n ===\n";
echo "\n=== acceptWindowInSeconds (null on $noWindow) ===\n";
print_r($windows);
echo "\n=== every top-level key, by frequency ===\n";
print_r($keys);

// =============================================================================
// PART 2 — run this after part 1. It inspects `expirationAction`, a field present
// on every real offer that exists NOWHERE in this repo. Its name suggests it says
// what Uber DOES when the 5s window closes — i.e. whether the offer is forwarded
// to the driver's own Uber app. That is the deadline this product actually races,
// so its values decide the whole feature.
// Also dumps driverInfo's sub-keys and one full offer, so nothing else stays hidden.
// =============================================================================

$expiry = [];
$driverKeys = [];
$sample = null;

foreach ($rows as $raw) {
    $o = json_decode($raw, true);
    if (! is_array($o) || ! isset($o['offerUUID'])) {
        continue;
    }

    $ea = $o['expirationAction'] ?? null;
    $key = is_scalar($ea) ? (string) $ea : json_encode($ea);
    $expiry[$key] = ($expiry[$key] ?? 0) + 1;

    if (is_array($o['driverInfo'] ?? null)) {
        foreach (array_keys($o['driverInfo']) as $dk) {
            $driverKeys[$dk] = ($driverKeys[$dk] ?? 0) + 1;
        }
    }

    // Keep the newest offer whose expirationAction is not the most common value,
    // so the sample shows the interesting case rather than another identical row.
    $sample ??= $o;
}

arsort($expiry);
arsort($driverKeys);
echo "\n\n=== expirationAction values (THE important one) ===\n";
print_r($expiry);
echo "\n=== driverInfo sub-keys ===\n";
print_r($driverKeys);
echo "\n=== one full offer, pretty-printed ===\n";
echo json_encode($sample, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
