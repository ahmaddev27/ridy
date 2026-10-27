<?php

namespace Tests\Unit;

use App\Domain\Auth\Webauthn\ChallengeStore;
use Tests\TestCase;

class WebauthnChallengeStoreTest extends TestCase
{
    public function test_a_stored_ceremony_is_returned_exactly_once(): void
    {
        $store = $this->app->make(ChallengeStore::class);

        $ceremonyId = $store->put('{"challenge":"abc"}');

        $this->assertNotSame('', $ceremonyId);
        $this->assertSame('{"challenge":"abc"}', $store->pull($ceremonyId));
        $this->assertNull($store->pull($ceremonyId));
    }

    public function test_an_unknown_ceremony_id_yields_nothing(): void
    {
        $store = $this->app->make(ChallengeStore::class);

        $this->assertNull($store->pull('does-not-exist'));
    }

    public function test_a_ceremony_expires_with_its_ttl(): void
    {
        config(['webauthn.challenge_ttl' => 60]);

        $store = $this->app->make(ChallengeStore::class);
        $ceremonyId = $store->put('{"challenge":"abc"}');

        $this->travel(61)->seconds();

        $this->assertNull($store->pull($ceremonyId));
    }

    public function test_two_ceremonies_do_not_collide(): void
    {
        $store = $this->app->make(ChallengeStore::class);

        $first = $store->put('{"challenge":"one"}');
        $second = $store->put('{"challenge":"two"}');

        $this->assertNotSame($first, $second);
        $this->assertSame('{"challenge":"two"}', $store->pull($second));
        $this->assertSame('{"challenge":"one"}', $store->pull($first));
    }
}
