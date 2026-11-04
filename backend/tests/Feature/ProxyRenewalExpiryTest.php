<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Proxy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ProxyRenewalExpiryTest extends TestCase
{
    use RefreshDatabase;

    private function proxy(string $expires): Proxy
    {
        return Proxy::create(['label' => 'p', 'url' => 'http://u:p@h:1', 'expires_at' => $expires]);
    }

    private function renew(Proxy $p, string $from, string $to): void
    {
        $p->renewals()->create(['amount' => 10, 'starts_at' => $from, 'ends_at' => $to]);
    }

    public function test_renewing_a_valid_proxy_extends_expires_at(): void
    {
        $p = $this->proxy(now()->addDays(5)->toDateString());
        $this->renew($p, '2026-11-04', '2026-12-07');

        $this->assertSame('2026-12-07', $p->fresh()->expires_at->toDateString());
    }

    public function test_renewing_an_expired_proxy_sets_expires_at(): void
    {
        $p = $this->proxy('2026-09-08');
        $this->renew($p, '2026-11-04', '2026-12-07');

        $this->assertSame('2026-12-07', $p->fresh()->expires_at->toDateString());
    }

    public function test_expires_at_tracks_the_latest_period_and_heals_on_delete(): void
    {
        $p = $this->proxy('2026-09-08');
        $this->renew($p, '2026-09-08', '2026-10-08');
        $this->renew($p, '2026-10-08', '2026-12-07');
        $this->renew($p, '2026-09-01', '2026-09-30');

        $this->assertSame('2026-12-07', $p->fresh()->expires_at->toDateString());

        $p->renewals()->whereDate('ends_at', '2026-12-07')->first()->delete();
        $this->assertSame('2026-10-08', $p->fresh()->expires_at->toDateString());
    }
}
