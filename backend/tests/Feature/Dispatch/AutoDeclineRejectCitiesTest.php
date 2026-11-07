<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\DispatchAutoDecline;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** The `reject_cities` Early-decline rule: PLZ-authoritative, fail-safe, no network. */
class AutoDeclineRejectCitiesTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    private const DRIVER_UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    private const MANNHEIM = 'Augustaanlage 1, 68165 Mannheim';

    private const DORTMUND = 'Königswall 15, 44137 Dortmund';

    private object $spy;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
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

        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'uber_org_uuid' => self::ORG]);
        $this->tenant->setDispatchRejectEnabled(true);
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => self::ORG, 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        $driver = Driver::create(['name' => 'Ahmed', 'uber_driver_uuid' => self::DRIVER_UUID]);
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 'phone', 'tenant_id' => $this->tenant->id]);
        $this->rules(['reject_cities' => ['enabled' => true, 'cities' => ['Mannheim']]]);
    }

    /** @param  array<string, mixed>  $rules */
    private function rules(array $rules, bool $adminEnabled = true): void
    {
        Driver::where('uber_driver_uuid', self::DRIVER_UUID)->update([
            'auto_decline' => ['admin_enabled' => $adminEnabled, 'enabled' => true, 'rules' => $rules],
        ]);
    }

    private function ingest(string $uuid, string $pickup, string $dropoff): ?string
    {
        $this->withHeader('X-Dispatch-Secret', self::SECRET)->postJson('/api/v1/internal/dispatch/ingest', [
            'seq' => 1,
            'offers' => [[
                'offerUUID' => $uuid,
                'realOfferUUID' => 'real-'.$uuid,
                'partnerUUID' => self::ORG,
                'driverInfo' => ['driverUUID' => self::DRIVER_UUID],
                'pickupAddress' => $pickup,
                'dropoffAddress' => $dropoff,
                'formattedUFP' => '€7.41',
                'acceptWindowInSeconds' => 5,
            ]],
        ])->assertOk();

        return DispatchOffer::withoutGlobalScopes()->where('offer_uuid', $uuid)->firstOrFail()->auto_decline_reason;
    }

    private function assertDeclined(?string $reason): void
    {
        $this->assertSame('reject_cities', $reason);
        $this->assertSame([], $this->spy->tokens, 'a declined offer is never pushed');
    }

    private function assertKept(?string $reason): void
    {
        $this->assertNull($reason);
        $this->assertSame(['phone'], $this->spy->tokens, 'the normal push still goes out');
    }

    public function test_pickup_in_a_blocked_city_is_declined_without_a_push_or_network(): void
    {
        $this->assertDeclined($this->ingest('o1', self::MANNHEIM, self::DORTMUND));
        Http::assertNothingSent();
    }

    public function test_dropoff_in_a_blocked_city_is_declined(): void
    {
        $this->assertDeclined($this->ingest('o2', self::DORTMUND, self::MANNHEIM));
    }

    public function test_neither_end_blocked_passes(): void
    {
        $this->assertKept($this->ingest('o3', self::DORTMUND, 'Weg 2, 44139 Dortmund'));
    }

    public function test_a_decline_is_reported_as_early_declined_by_the_ingest(): void
    {
        $this->withHeader('X-Dispatch-Secret', self::SECRET)->postJson('/api/v1/internal/dispatch/ingest', [
            'seq' => 1,
            'offers' => [[
                'offerUUID' => 'o4', 'realOfferUUID' => 'real-o4', 'partnerUUID' => self::ORG,
                'driverInfo' => ['driverUUID' => self::DRIVER_UUID],
                'pickupAddress' => self::MANNHEIM, 'dropoffAddress' => self::DORTMUND,
                'formattedUFP' => '€7.41', 'acceptWindowInSeconds' => 5,
            ]],
        ])->assertOk()->assertJsonPath('data.early_declined', 1)->assertJsonPath('data.routed', 0);
    }

    public function test_matching_ignores_case_and_umlaut_spelling(): void
    {
        $this->rules(['reject_cities' => ['enabled' => true, 'cities' => ['duesseldorf']]]);
        $this->assertDeclined($this->ingest('o5', 'Königsallee 1, 40210 Düsseldorf', self::DORTMUND));
    }

    public function test_matching_ignores_case_in_multiword_names(): void
    {
        $this->rules(['reject_cities' => ['enabled' => true, 'cities' => ['ludwigshafen AM rhein']]]);
        $this->assertDeclined($this->ingest('o6', 'Weg 1, 67059 Ludwigshafen am Rhein', self::DORTMUND));
    }

    public function test_a_blocked_prefix_never_matches_a_longer_hyphenated_city(): void
    {
        // PLZ 01458 is "Ottendorf-Okrilla"; blocking "Ottendorf" must not hit it.
        $this->rules(['reject_cities' => ['enabled' => true, 'cities' => ['Ottendorf']]]);
        $this->assertKept($this->ingest('o7', 'Weg 1, 01458 Ottendorf-Okrilla', self::DORTMUND));
    }

    public function test_a_blocked_sub_district_name_does_not_block_the_parent_city(): void
    {
        $this->rules(['reject_cities' => ['enabled' => true, 'cities' => ['Mannheim-Neckarau']]]);
        $this->assertKept($this->ingest('o8', self::MANNHEIM, self::DORTMUND));
    }

    public function test_an_address_without_a_plz_never_declines_even_naming_the_city(): void
    {
        $this->assertKept($this->ingest('o9', 'Augustaanlage 1, Mannheim', self::DORTMUND));
    }

    public function test_an_unknown_plz_never_declines(): void
    {
        $this->assertKept($this->ingest('o10', 'Weg 1, 00001 Mannheim', self::DORTMUND));
    }

    public function test_two_different_plzs_in_one_address_never_decline(): void
    {
        // Called directly: ingest-time tidying would already drop a trailing second PLZ segment.
        $offer = new DispatchOffer(['pickup_address' => 'Weg 1, 68165 Mannheim, 44137 Dortmund']);
        $offer->setRelation('tenant', $this->tenant->fresh());
        $driver = Driver::where('uber_driver_uuid', self::DRIVER_UUID)->first();

        $this->assertNull(app(DispatchAutoDecline::class)->match($offer, $driver));
    }

    public function test_text_town_contradicting_the_plz_never_declines(): void
    {
        // PLZ says Dortmund; the text claims Mannheim -> ambiguous -> keep.
        $this->assertKept($this->ingest('o12', 'Weg 1, 44137 Mannheim', self::DORTMUND));
    }

    public function test_one_untrusted_end_does_not_stop_the_other_from_blocking(): void
    {
        $this->assertDeclined($this->ingest('o13', 'Irgendwo ohne PLZ', self::MANNHEIM));
    }

    public function test_a_disabled_or_empty_or_malformed_rule_never_declines(): void
    {
        $cases = [
            'disabled' => ['enabled' => false, 'cities' => ['Mannheim']],
            'empty' => ['enabled' => true, 'cities' => []],
            'non-array' => ['enabled' => true, 'cities' => 'Mannheim'],
            'junk-entries' => ['enabled' => true, 'cities' => [null, 5, '  ']],
        ];
        foreach ($cases as $name => $rule) {
            $this->spy->tokens = [];
            $this->rules(['reject_cities' => $rule]);
            $this->assertKept($this->ingest('c-'.$name, self::MANNHEIM, self::DORTMUND));
        }
    }

    public function test_the_fare_floor_wins_the_precedence_when_both_match(): void
    {
        $this->rules([
            'min_fare' => ['enabled' => true, 'value_e2' => 1000],
            'reject_cities' => ['enabled' => true, 'cities' => ['Mannheim']],
        ]);

        $this->assertSame('min_fare', $this->ingest('o14', self::MANNHEIM, self::DORTMUND));
    }

    public function test_cities_decline_when_the_fare_is_fine(): void
    {
        $this->rules([
            'min_fare' => ['enabled' => true, 'value_e2' => 500],
            'reject_cities' => ['enabled' => true, 'cities' => ['Mannheim']],
        ]);

        $this->assertDeclined($this->ingest('o15', self::MANNHEIM, self::DORTMUND));
    }

    public function test_an_admin_revoked_driver_is_never_declined(): void
    {
        $this->rules(['reject_cities' => ['enabled' => true, 'cities' => ['Mannheim']]], adminEnabled: false);
        $this->assertKept($this->ingest('o16', self::MANNHEIM, self::DORTMUND));
    }

    public function test_a_company_with_declines_off_is_never_declined(): void
    {
        $this->tenant->setDispatchRejectEnabled(false);
        $this->assertKept($this->ingest('o17', self::MANNHEIM, self::DORTMUND));
    }

    public function test_an_engine_fault_never_changes_routing(): void
    {
        $offer = new DispatchOffer(['pickup_address' => self::MANNHEIM]);
        $offer->setRelation('tenant', $this->tenant->fresh());
        $driver = Driver::where('uber_driver_uuid', self::DRIVER_UUID)->first();
        // A broken postal-code lookup must be absorbed: no decline, no exception.
        DB::statement('DROP TABLE postal_codes');
        Cache::flush();

        $this->assertNull(app(DispatchAutoDecline::class)->match($offer, $driver));
    }
}
