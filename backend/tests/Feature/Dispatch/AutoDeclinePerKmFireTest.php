<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\DeclineGradeGeo;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\TripGeocoder;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** The €/km Early-decline rule fires only on a high-confidence inline road distance. */
class AutoDeclinePerKmFireTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    private const DRIVER_UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    private object $spy;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake(); // async GeocodeOffer must not interfere with what the inline path decided
        config(['services.dispatch.ingest_secret' => self::SECRET]);
        $this->spy = new class implements PushSender
        {
            public array $tokens = [];

            public function send(string $deviceToken, string $title, string $body, array $data = []): bool
            {
                $this->tokens[] = $deviceToken;

                return true;
            }
        };
        $this->app->instance(PushSender::class, $this->spy);

        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'uber_org_uuid' => self::ORG]);
        $tenant->setDispatchRejectEnabled(true);
        $tenant->forceFill(['settings' => array_merge($tenant->settings ?? [], ['auto_decline' => ['enabled' => true]])])->save();
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'uber_org_uuid' => self::ORG, 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);
        app(TenantContext::class)->set($tenant->id);
        $driver = Driver::create(['name' => 'Mhmoud', 'uber_driver_uuid' => self::DRIVER_UUID]);
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 'phone', 'tenant_id' => $tenant->id]);
        $this->rules(['min_price_per_km' => ['enabled' => true, 'value_e2' => 200, 'mode' => 'and']]);
    }

    /** @param  array<string, mixed>  $rules */
    private function rules(array $rules): void
    {
        Driver::where('uber_driver_uuid', self::DRIVER_UUID)->update([
            'auto_decline' => ['admin_enabled' => true, 'enabled' => true, 'rules' => $rules],
        ]);
    }

    /** A Nominatim hit for a street; $override replaces address fields (to forge a mismatch). */
    private function hit(float $lat, float $lng, string $road, string $no, string $plz, string $city, array $override = []): array
    {
        return [[
            'lat' => (string) $lat, 'lon' => (string) $lng, 'class' => 'place', 'type' => 'house',
            'display_name' => "$road $no, $city",
            'address' => array_merge(['road' => $road, 'house_number' => $no, 'postcode' => $plz, 'city' => $city], $override),
        ]];
    }

    /** Fake Nominatim (pickup/dropoff by street) + OSRM. $osrm null = unreachable. */
    private function fakeGeo(?float $osrmMeters = 5500.0, array $pickupOverride = [], array $dropoffOverride = []): void
    {
        Http::fake(function (Request $request) use ($osrmMeters, $pickupOverride, $dropoffOverride) {
            if (str_contains($request->url(), '/route/v1/driving')) {
                return $osrmMeters === null
                    ? Http::response('', 500)
                    : Http::response(['routes' => [['distance' => $osrmMeters, 'geometry' => ['type' => 'LineString', 'coordinates' => [[7.46, 51.51], [7.43, 51.48]]]]]]);
            }
            $street = (string) ($request->data()['street'] ?? '');

            return Http::response(str_contains($street, 'Königswall')
                ? $this->hit(51.5136, 7.4653, 'Königswall', '15', '44137', 'Dortmund', $pickupOverride)
                : $this->hit(51.4800, 7.4300, 'Bunsen-Kirchhoff-Straße', '11', '44139', 'Dortmund', $dropoffOverride));
        });
    }

    private function offer(string $uuid, string $fare = '€7.41', string $pickup = 'Königswall 15, 44137 Dortmund', string $dropoff = 'Bunsen-Kirchhoff-Straße 11, 44139 Dortmund'): array
    {
        return [
            'offerUUID' => $uuid, 'realOfferUUID' => 'real-'.$uuid, 'partnerUUID' => self::ORG, 'driverInfo' => ['driverUUID' => self::DRIVER_UUID],
            'pickupAddress' => $pickup, 'dropoffAddress' => $dropoff, 'formattedUFP' => $fare, 'acceptWindowInSeconds' => 5,
        ];
    }

    private function ingest(array $offer): DispatchOffer
    {
        $this->withHeader('X-Dispatch-Secret', self::SECRET)
            ->postJson('/api/v1/internal/dispatch/ingest', ['offers' => [$offer], 'seq' => 1])
            ->assertOk();

        return DispatchOffer::withoutGlobalScopes()->where('offer_uuid', $offer['offerUUID'])->firstOrFail();
    }

    private function assertNoGeoCalls(): void
    {
        Http::assertNotSent(fn (Request $r) => str_contains($r->url(), '/search') || str_contains($r->url(), '/route/v1'));
    }

    private function assertKept(DispatchOffer $record): void
    {
        $this->assertNull($record->auto_decline_reason);
        $this->assertSame(['phone'], $this->spy->tokens, 'a kept offer is still pushed');
    }

    public function test_declines_on_a_confident_low_per_km(): void
    {
        $this->fakeGeo(5500.0); // €7.41 / 5.5 km = €1.35/km < €2.00
        $record = $this->ingest($this->offer('o-low'));

        $this->assertSame('min_price_per_km', $record->auto_decline_reason);
        $this->assertSame([], $this->spy->tokens, 'push suppressed');
    }

    public function test_keeps_a_confident_offer_above_the_floor(): void
    {
        $this->fakeGeo(2500.0); // €2.96/km
        $this->assertKept($this->ingest($this->offer('o-ok')));
    }

    public function test_logs_one_structured_line(): void
    {
        Log::spy();
        $this->fakeGeo(5500.0);
        $this->ingest($this->offer('o-log'));

        Log::shouldHaveReceived('info')->withArgs(fn ($m, $c = []) => $m === 'dispatch.per_km_eval' && $c['outcome'] === 'declined' && $c['distance_m'] === 5500)->once();
    }

    public function test_osrm_estimate_keeps_the_offer_and_leaves_no_permanent_estimate(): void
    {
        Queue::fake(); // the async GeocodeOffer must not run here; we assert it still can
        $this->fakeGeo(null);
        $record = $this->ingest($this->offer('o-est'));

        $this->assertKept($record);
        $this->assertNull($record->geo_synced_at, 'async GeocodeOffer must still be able to run');
        $this->assertNull($record->distance_m);
        $this->assertNull($record->geo_confidence);
    }

    public function test_label_mismatch_keeps_the_offer(): void
    {
        $this->fakeGeo(5500.0, pickupOverride: ['house_number' => '99']);
        $this->assertKept($this->ingest($this->offer('o-label')));
    }

    public function test_wrong_city_in_label_keeps_the_offer(): void
    {
        $this->fakeGeo(5500.0, dropoffOverride: ['city' => 'Hamburg']);
        $this->assertKept($this->ingest($this->offer('o-city')));
    }

    public function test_no_house_number_keeps_the_offer(): void
    {
        $this->fakeGeo(5500.0);
        $this->assertKept($this->ingest($this->offer('o-nohn', pickup: 'Königswall, 44137 Dortmund')));
    }

    public function test_no_plz_keeps_the_offer(): void
    {
        $this->fakeGeo(5500.0);
        $this->assertKept($this->ingest($this->offer('o-noplz', dropoff: 'Bunsen-Kirchhoff-Straße 11, Dortmund')));
    }

    public function test_street_level_geocode_keeps_the_offer(): void
    {
        // A hit without a house number on a numbered query still yields 'exact' by
        // query shape, so force non-exact by dropping the street entirely: PLZ+city only.
        $this->fakeGeo(5500.0);
        $this->assertKept($this->ingest($this->offer('o-postal', pickup: '44137 Dortmund')));
    }

    public function test_unreachable_geocoder_keeps_the_offer(): void
    {
        Http::fake(fn () => Http::response('', 500));
        $this->assertKept($this->ingest($this->offer('o-down')));
    }

    public function test_min_fare_fires_first_with_zero_network(): void
    {
        $this->rules([
            'min_fare' => ['enabled' => true, 'value_e2' => 1000],
            'min_price_per_km' => ['enabled' => true, 'value_e2' => 200, 'mode' => 'and'],
        ]);
        Http::fake();
        $record = $this->ingest($this->offer('o-fare'));

        $this->assertSame('min_fare', $record->auto_decline_reason);
        Http::assertNothingSent();
    }

    public function test_or_mode_with_passing_fare_needs_no_network_and_keeps(): void
    {
        $this->rules([
            'min_fare' => ['enabled' => true, 'value_e2' => 500],
            'min_price_per_km' => ['enabled' => true, 'value_e2' => 200, 'mode' => 'or'],
        ]);
        Http::fake();
        $this->assertKept($this->ingest($this->offer('o-or-ok')));
        $this->assertNoGeoCalls();
    }

    public function test_or_mode_declines_when_both_fail(): void
    {
        $this->rules([
            'min_fare' => ['enabled' => true, 'value_e2' => 1000],
            'min_price_per_km' => ['enabled' => true, 'value_e2' => 200, 'mode' => 'or'],
        ]);
        $this->fakeGeo(5500.0);

        $this->assertSame('min_fare', $this->ingest($this->offer('o-or-bad'))->auto_decline_reason);
    }

    public function test_and_mode_declines_on_per_km_when_fare_passes(): void
    {
        $this->rules([
            'min_fare' => ['enabled' => true, 'value_e2' => 500],
            'min_price_per_km' => ['enabled' => true, 'value_e2' => 200, 'mode' => 'and'],
        ]);
        $this->fakeGeo(5500.0);

        $this->assertSame('min_price_per_km', $this->ingest($this->offer('o-and'))->auto_decline_reason);
    }

    public function test_no_fare_never_declines_and_does_no_network(): void
    {
        Http::fake();
        $record = $this->ingest($this->offer('o-nofare', fare: ''));

        $this->assertKept($record);
        $this->assertNoGeoCalls();
    }

    public function test_an_exception_in_the_geocoder_keeps_the_offer(): void
    {
        $this->mock(TripGeocoder::class)->shouldReceive('enrichForDecline')->andThrow(new \RuntimeException('boom'));
        $this->assertKept($this->ingest($this->offer('o-boom')));
    }

    /** @return array<string, array{0: array<string, mixed>, 1: ?string}> */
    public static function plausibilityCases(): array
    {
        $pick = ['lat' => 51.5136, 'lng' => 7.4653, 'confidence' => 'exact'];
        $drop = ['lat' => 51.4800, 'lng' => 7.4300, 'confidence' => 'exact'];

        return [
            'too short' => [['distance_m' => 500, 'drop' => $drop], 'distance_out_of_range'],
            'too long' => [['distance_m' => 200000, 'drop' => $drop], 'distance_out_of_range'],
            'detour ratio too high' => [['distance_m' => 40000, 'drop' => $drop], 'implausible_ratio'],
            'shorter than crow flies' => [['distance_m' => 2000, 'drop' => $drop], 'implausible_ratio'],
            'same point' => [['distance_m' => 3000, 'drop' => $pick], 'same_point'],
            'ok' => [['distance_m' => 5500, 'drop' => $drop], null],
        ];
    }

    /** @param  array<string, mixed>  $case */
    #[DataProvider('plausibilityCases')]
    public function test_grade_plausibility_guards(array $case, ?string $skip): void
    {
        $pick = ['lat' => 51.5136, 'lng' => 7.4653, 'confidence' => 'exact', 'address' => 'Königswall 15, 44137 Dortmund'];
        $drop = $case['drop'] + ['address' => $case['drop']['lat'] === $pick['lat'] ? $pick['address'] : 'Bunsen-Kirchhoff-Straße 11, 44139 Dortmund'];
        $offer = new DispatchOffer([
            'pickup_address' => 'Königswall 15, 44137 Dortmund',
            'dropoff_address' => $case['drop']['lat'] === $pick['lat'] ? 'Königswall 15, 44137 Dortmund' : 'Bunsen-Kirchhoff-Straße 11, 44139 Dortmund',
            'distance_m' => $case['distance_m'], 'geo_confidence' => 'exact',
        ]);

        $this->assertSame($skip, DeclineGradeGeo::assess($offer, ['pickup' => $pick, 'dropoff' => $drop])['skip']);
    }

    public function test_grade_rejects_uber_source_and_estimated(): void
    {
        $pick = ['lat' => 51.5136, 'lng' => 7.4653, 'confidence' => 'exact', 'address' => 'Königswall 15, 44137 Dortmund'];
        $drop = ['lat' => 51.48, 'lng' => 7.43, 'confidence' => 'exact', 'address' => 'Bunsen-Kirchhoff-Straße 11, 44139 Dortmund'];
        $base = ['pickup_address' => 'Königswall 15, 44137 Dortmund', 'dropoff_address' => 'Bunsen-Kirchhoff-Straße 11, 44139 Dortmund', 'distance_m' => 5500];

        $uber = new DispatchOffer($base + ['geo_confidence' => 'exact', 'geo_source' => 'uber']);
        $estimated = new DispatchOffer(array_merge($base, ['geo_confidence' => 'estimated']));

        $this->assertSame('uber_source', DeclineGradeGeo::assess($uber, ['pickup' => $pick, 'dropoff' => $drop])['skip']);
        $this->assertSame('estimated_route', DeclineGradeGeo::assess($estimated, ['pickup' => $pick, 'dropoff' => $drop])['skip']);
        $this->assertSame('unresolved', DeclineGradeGeo::assess($estimated, ['pickup' => $pick, 'dropoff' => null])['skip']);
    }
}
