<?php

namespace Tests\Feature\Notifications;

use App\Domain\Notifications\Push\FcmPushSender;
use App\Domain\Notifications\Push\GoogleServiceAccountToken;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * A hung FCM connection (cURL 28, 0 bytes) must not lose the offer: one retry on
 * a fresh connection, inside the accept window. Other failures are not retried.
 */
class FcmRetryTest extends TestCase
{
    private function sender(): FcmPushSender
    {
        $auth = new class('x') extends GoogleServiceAccountToken
        {
            public function accessToken(): string
            {
                return 'test-access-token';
            }
        };

        return new FcmPushSender($auth, 'my-project');
    }

    public function test_a_failed_connection_is_retried_once_and_the_push_goes_out(): void
    {
        Http::fake(['https://fcm.googleapis.com/*' => Http::sequence()
            ->pushFailedConnection('cURL error 28: Operation timed out')
            ->push(['name' => 'projects/p/messages/1'])]);

        $this->assertTrue($this->sender()->send('device-1', 'T', 'B', ['offer_id' => '9']));
        Http::assertSentCount(2);
    }

    public function test_two_failed_connections_give_up_after_the_retry(): void
    {
        Http::fake(['https://fcm.googleapis.com/*' => Http::sequence()
            ->pushFailedConnection()
            ->pushFailedConnection()
            ->push(['name' => 'never-reached'])]);

        $this->assertFalse($this->sender()->send('device-1', 'T', 'B', ['offer_id' => '9']));
        Http::assertSentCount(2);
    }

    public function test_an_fcm_error_response_is_not_retried(): void
    {
        Http::fake(['https://fcm.googleapis.com/*' => Http::response(['error' => ['message' => 'boom']], 500)]);

        $this->assertFalse($this->sender()->send('device-1', 'T', 'B', ['offer_id' => '9']));
        Http::assertSentCount(1);
    }

    public function test_send_many_retries_only_the_devices_whose_connection_failed(): void
    {
        Http::fake(['https://fcm.googleapis.com/*' => Http::sequence()
            ->push(['name' => 'ok-a'])
            ->pushFailedConnection()
            ->push(['name' => 'ok-b-retry'])]);

        $sent = $this->sender()->sendMany(['device-a', 'device-b'], 'T', 'B', ['offer_id' => '9']);

        // Without the retry device-b's failed connection would leave this at 1.
        // (The fake doesn't record a pooled failed connection as "sent", so the
        // delivered count — not assertSentCount — is the proof.)
        $this->assertSame(2, $sent);
    }
}
