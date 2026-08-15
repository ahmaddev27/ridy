<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\DispatchNotifier;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Notifications\Push\FcmPushSender;
use App\Domain\Notifications\Push\GoogleServiceAccountToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class DispatchPushTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        app(TenantContext::class)->set($tenant->id);
    }

    public function test_notifier_pushes_to_every_device_localized(): void
    {
        $driver = Driver::create(['name' => 'Omar', 'locale' => 'ar']);
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 't1', 'tenant_id' => $driver->tenant_id]);
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 't2', 'tenant_id' => $driver->tenant_id]);

        $offer = DispatchOffer::create([
            'driver_id' => $driver->id, 'driver_uuid' => 'u1', 'offer_uuid' => 'o1',
            'pickup_address' => 'Airport', 'fare_formatted' => '€14.37', 'fare_amount' => 14.37,
            'received_at' => now(), 'raw_payload' => [], 'status' => OfferStatus::Pending,
        ]);

        $spy = new class implements PushSender
        {
            public array $calls = [];

            public function send(string $deviceToken, string $title, string $body, array $data = []): bool
            {
                $this->calls[] = compact('deviceToken', 'title', 'data');

                return true;
            }
        };

        $sent = (new DispatchNotifier($spy))->notify($offer);

        $this->assertSame(2, $sent);
        $this->assertCount(2, $spy->calls);
        $this->assertSame('عرض أوبر جديد', $spy->calls[0]['title']); // Arabic locale
        $this->assertSame((string) $offer->id, $spy->calls[0]['data']['offer_id']);
        $this->assertSame('14.37', $spy->calls[0]['data']['fare_amount']);
    }

    public function test_fcm_sender_posts_high_priority_v1_message(): void
    {
        Http::fake(['https://fcm.googleapis.com/*' => Http::response(['name' => 'projects/p/messages/1'])]);

        $auth = new class('x') extends GoogleServiceAccountToken
        {
            public function accessToken(): string
            {
                return 'test-access-token';
            }
        };

        $ok = (new FcmPushSender($auth, 'my-project'))
            ->send('device-1', 'Title', 'Body', ['offer_id' => '9']);

        $this->assertTrue($ok);
        Http::assertSent(function ($request) {
            $msg = $request->data()['message'];

            return str_contains($request->url(), '/projects/my-project/messages:send')
                && $request->hasHeader('Authorization', 'Bearer test-access-token')
                && $msg['android']['priority'] === 'high'
                && $msg['apns']['headers']['apns-priority'] === '10'
                && $msg['data']['offer_id'] === '9';
        });
    }

    public function test_service_account_token_is_cached(): void
    {
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        if ($key === false || ! openssl_pkey_export($key, $pem)) {
            $this->markTestSkipped('openssl RSA key generation unavailable in this environment.');
        }

        $path = tempnam(sys_get_temp_dir(), 'fcm');
        file_put_contents($path, json_encode([
            'client_email' => 'svc@p.iam.gserviceaccount.com',
            'private_key' => $pem,
            'project_id' => 'p',
            'token_uri' => 'https://oauth2.googleapis.com/token',
        ]));

        Http::fake(['https://oauth2.googleapis.com/token' => Http::response(['access_token' => 'abc', 'expires_in' => 3600])]);

        $auth = new GoogleServiceAccountToken($path);
        $this->assertSame('abc', $auth->accessToken());
        $this->assertSame('abc', $auth->accessToken()); // second call served from cache
        Http::assertSentCount(1);

        @unlink($path);
    }
}
