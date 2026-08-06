<?php

namespace Tests\Feature;

use App\Domain\Dispatch\DispatchOfferIngestor;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DispatchNotificationTest extends TestCase
{
    use RefreshDatabase;

    private const DRIVER_UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    private Tenant $tenant;

    /** @var array<int, array{token: string, title: string, body: string}> */
    private array $sent = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'uber_org_uuid' => 'org1']);
        app(TenantContext::class)->set($this->tenant->id);

        // Capture every push instead of hitting FCM.
        $this->app->instance(PushSender::class, new class($this->sent) implements PushSender
        {
            public function __construct(private array &$sent) {}

            public function send(string $deviceToken, string $title, string $body, array $data = []): bool
            {
                $this->sent[] = ['token' => $deviceToken, 'title' => $title, 'body' => $body, 'data' => $data];

                return true;
            }
        });
    }

    private function offer(): array
    {
        return [
            'offerUUID' => 'offer-'.uniqid(),
            'partnerUUID' => 'org1',
            'driverInfo' => ['driverUUID' => self::DRIVER_UUID, 'firstName' => 'Mhmoud', 'lastName' => 'Zedya'],
            'pickupAddress' => 'Alexanderplatz, Berlin',
            'formattedUFP' => '€7.41',
            'acceptWindowInSeconds' => 5,
        ];
    }

    public function test_routed_offer_pushes_to_all_driver_devices(): void
    {
        $driver = Driver::create(['name' => 'Mhmoud', 'uber_driver_uuid' => self::DRIVER_UUID]);
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 'tokenA', 'platform' => 'android']);
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 'tokenB', 'platform' => 'ios']);

        app(DispatchOfferIngestor::class)->ingest($this->tenant->id, $this->offer());

        $this->assertCount(2, $this->sent);
        $this->assertSame('Neues Uber-Angebot', $this->sent[0]['title']);
        $this->assertStringContainsString('€7.41', $this->sent[0]['body']);
        $this->assertSame('Alexanderplatz, Berlin', $this->sent[0]['data']['pickup']);
    }

    public function test_unlinked_offer_pushes_to_nobody(): void
    {
        app(DispatchOfferIngestor::class)->ingest($this->tenant->id, $this->offer());

        $this->assertCount(0, $this->sent);
    }

    public function test_driver_app_registers_device_token(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $driver = Driver::create(['name' => 'Mhmoud', 'uber_driver_uuid' => self::DRIVER_UUID]);
        $user = User::create([
            'name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id,
        ]);
        Sanctum::actingAs($user);

        $this->postJson('/api/v1/devices', [
            'uber_driver_uuid' => self::DRIVER_UUID,
            'token' => 'fcm-token-xyz',
            'platform' => 'android',
        ])->assertCreated()->assertJsonPath('data.driver_id', $driver->id);

        $this->assertDatabaseHas('device_tokens', ['token' => 'fcm-token-xyz', 'driver_id' => $driver->id]);
    }
}
