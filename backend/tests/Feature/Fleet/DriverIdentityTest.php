<?php

namespace Tests\Feature\Fleet;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Privacy\DriverEraser;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Driver login identity: email changes, duplicate emails, and per-driver erasure. */
class DriverIdentityTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth()]);
        app(TenantContext::class)->set($this->tenant->id);
        $manager = User::create(['name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id]);
        $manager->assignRole('fleet_manager');
        Sanctum::actingAs($manager);
    }

    private function driver(array $o = []): Driver
    {
        return Driver::create(array_merge(['tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => 'omar@ya.de'], $o));
    }

    public function test_changing_the_login_email_signs_the_previous_holder_out(): void
    {
        $driver = $this->driver(['activated_at' => now()]);
        $driver->createToken('driver-app');
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 'old-phone', 'tenant_id' => $this->tenant->id]);

        $this->patchJson("/api/v1/drivers/{$driver->id}", ['email' => 'new@ya.de'])->assertOk();

        $this->assertSame('new@ya.de', $driver->fresh()->email);
        $this->assertSame(0, $driver->tokens()->count());
        $this->assertSame(0, DeviceToken::withoutGlobalScopes()->where('driver_id', $driver->id)->count());
    }

    public function test_re_saving_the_same_email_keeps_the_session(): void
    {
        $driver = $this->driver();
        $driver->createToken('driver-app');

        $this->patchJson("/api/v1/drivers/{$driver->id}", ['email' => 'omar@ya.de'])->assertOk();

        $this->assertSame(1, $driver->tokens()->count());
    }

    public function test_a_driver_email_cannot_be_another_companys_dashboard_login(): void
    {
        $other = Tenant::create(['name' => 'Other', 'country' => 'DE']);
        User::create(['name' => 'Boss', 'email' => 'boss@other.de', 'password' => Hash::make('x'), 'tenant_id' => $other->id]);
        $driver = $this->driver();

        $this->patchJson("/api/v1/drivers/{$driver->id}", ['email' => 'boss@other.de'])->assertStatus(422);
    }

    public function test_inviting_with_an_uber_email_taken_by_another_fleets_driver_is_a_422_not_a_500(): void
    {
        $other = Tenant::create(['name' => 'Other', 'country' => 'DE']);
        Driver::withoutGlobalScopes()->create(['tenant_id' => $other->id, 'name' => 'X', 'email' => 'shared@uber.de']);
        $driver = $this->driver(['email' => null, 'uber_email' => 'shared@uber.de']);

        $this->postJson("/api/v1/drivers/{$driver->id}/invite")->assertStatus(422);
        $this->assertNull($driver->fresh()->email);
    }

    public function test_a_removed_driver_can_be_erased_and_their_offers_are_anonymized(): void
    {
        $driver = $this->driver(['uber_driver_uuid' => 'uuid-1', 'roster_removed_at' => now()]);
        $driver->createToken('driver-app');
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 'phone', 'tenant_id' => $this->tenant->id]);
        DB::table('notifications')->insert([
            'id' => 'n-1', 'type' => 'x', 'notifiable_type' => $driver->getMorphClass(), 'notifiable_id' => $driver->id,
            'data' => '{}', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $offer = DispatchOffer::create([
            'tenant_id' => $this->tenant->id, 'driver_id' => $driver->id, 'driver_uuid' => 'uuid-1', 'offer_uuid' => 'o1',
            'driver_first_name' => 'Omar', 'rider_first_name' => 'Lena', 'pickup_address' => 'Hauptstr. 1, Berlin',
            'pickup_lat' => 52.5, 'pickup_lng' => 13.4, 'fare_amount' => 12.5, 'received_at' => now(),
            'raw_payload' => ['driverInfo' => ['firstName' => 'Omar'], 'fare' => 5],
        ]);

        // The dashboard uses the same eraser as `drivers:erase`: a complete Art. 17 wipe.
        $this->deleteJson("/api/v1/drivers/{$driver->id}")->assertOk()
            ->assertJsonPath('data.offers_anonymized', 1)
            ->assertJsonPath('data.notifications', 1);

        $this->assertNull(Driver::withoutGlobalScopes()->find($driver->id));
        $this->assertSame(0, DB::table('personal_access_tokens')->count());
        $this->assertSame(0, DeviceToken::withoutGlobalScopes()->count());
        $this->assertSame(0, DB::table('notifications')->where('notifiable_id', $driver->id)->count());
        $fresh = DispatchOffer::withoutGlobalScopes()->find($offer->id);
        $this->assertNull($fresh->driver_id);
        $this->assertSame(DriverEraser::ERASED_UUID, $fresh->driver_uuid);
        $this->assertNull($fresh->driver_first_name);
        $this->assertNull($fresh->rider_first_name);
        $this->assertNull($fresh->pickup_address);
        $this->assertNull($fresh->pickup_lat);
        $this->assertNotNull($fresh->anonymized_at);
        $this->assertSame('{}', DB::table('dispatch_offers')->where('id', $offer->id)->value('raw_payload'));
        $this->assertEquals(12.5, (float) $fresh->fare_amount); // the fleet keeps its figures
    }

    public function test_a_driver_still_on_the_uber_roster_cannot_be_erased(): void
    {
        $driver = $this->driver(['uber_driver_uuid' => 'uuid-1']);

        $this->deleteJson("/api/v1/drivers/{$driver->id}")->assertStatus(422);
        $this->assertNotNull($driver->fresh());
    }
}
