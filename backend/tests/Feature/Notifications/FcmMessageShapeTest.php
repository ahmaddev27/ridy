<?php

namespace Tests\Feature\Notifications;

use App\Domain\Notifications\Push\FcmPushSender;
use App\Domain\Notifications\Push\GoogleServiceAccountToken;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class FcmMessageShapeTest extends TestCase
{
    private function sender(): FcmPushSender
    {
        $auth = new class('x') extends GoogleServiceAccountToken
        {
            public function accessToken(): string
            {
                return 'tok';
            }
        };

        return new FcmPushSender($auth, 'p');
    }

    /** @return array<string, mixed> */
    private function sentMessage(array $data): array
    {
        Http::fake(['https://fcm.googleapis.com/*' => Http::response(['name' => 'x'])]);
        $this->sender()->send('device', 'T', 'B', $data);

        $message = null;
        Http::assertSent(function ($request) use (&$message) {
            $message = $request->data()['message'];

            return true;
        });

        return $message;
    }

    public function test_offer_push_expires_quickly_collapses_and_is_time_sensitive(): void
    {
        $before = time();
        $msg = $this->sentMessage(['categoryId' => 'offer', 'offer_id' => '42', 'accept_window' => '15']);

        $this->assertSame('45s', $msg['android']['ttl']);
        $this->assertSame('offer-42', $msg['android']['collapse_key']);
        $this->assertSame('offer-42', $msg['android']['notification']['tag']);
        $this->assertSame('offers', $msg['android']['notification']['channel_id']);
        $this->assertSame('high', $msg['android']['priority']);

        $headers = $msg['apns']['headers'];
        $this->assertSame('10', $headers['apns-priority']);
        $this->assertSame('alert', $headers['apns-push-type']);
        $this->assertSame('offer-42', $headers['apns-collapse-id']);
        $this->assertGreaterThanOrEqual($before + 45, (int) $headers['apns-expiration']);
        $this->assertLessThanOrEqual(time() + 45, (int) $headers['apns-expiration']);

        $aps = $msg['apns']['payload']['aps'];
        $this->assertSame('time-sensitive', $aps['interruption-level']);
        $this->assertArrayNotHasKey('content-available', $aps);
    }

    public function test_broadcast_and_test_pushes_keep_default_delivery(): void
    {
        $msg = $this->sentMessage(['type' => 'admin_broadcast', 'href' => '/x']);

        $this->assertArrayNotHasKey('ttl', $msg['android']);
        $this->assertArrayNotHasKey('collapse_key', $msg['android']);
        $this->assertArrayNotHasKey('apns-expiration', $msg['apns']['headers']);
        $this->assertArrayNotHasKey('apns-collapse-id', $msg['apns']['headers']);
        $this->assertArrayNotHasKey('interruption-level', $msg['apns']['payload']['aps']);
        $this->assertSame('alert', $msg['apns']['headers']['apns-push-type']);
    }

    public function test_offer_ttl_is_clamped(): void
    {
        $this->assertSame(45, FcmPushSender::offerTtlSeconds([]));
        $this->assertSame(35, FcmPushSender::offerTtlSeconds(['accept_window' => '5']));
        $this->assertSame(120, FcmPushSender::offerTtlSeconds(['accept_window' => '600']));
    }
}
