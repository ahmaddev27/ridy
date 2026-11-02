<?php

namespace Tests\Unit;

use App\Domain\Dispatch\CobrowseTicketSigner;
use Tests\TestCase;

class CobrowseTicketSignerTest extends TestCase
{
    private const SECRET = 'test-secret-0123456789';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.uber_auth.secret' => self::SECRET]);
    }

    private function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    public function test_the_login_hash_is_the_first_16_hex_chars_of_sha256(): void
    {
        $this->assertSame('b94d27b9934d3e08', CobrowseTicketSigner::loginHash('hello world'));
    }

    public function test_the_ticket_matches_the_uber_auth_wire_format_byte_for_byte(): void
    {
        $t = (new CobrowseTicketSigner)->mint('42', 'LID-9', 7, 1_800_000_000);

        [$body, $sig] = explode('.', $t['ticket']);
        // key = HMAC_SHA256(UBER_AUTH_SECRET, "cobrowse-v1") -> 32 raw bytes
        $key = hash_hmac('sha256', 'cobrowse-v1', self::SECRET, true);
        $this->assertSame(32, strlen($key));
        $this->assertSame($this->b64(hash_hmac('sha256', $body, $key, true)), $sig);

        $payload = json_decode(base64_decode(strtr($body, '-_', '+/')), true);
        $this->assertSame(['tid', 'sid', 'lh', 'uid', 'jti', 'exp'], array_keys($payload));
        $this->assertSame('42', $payload['tid']);
        $this->assertSame($t['sid'], $payload['sid']);
        $this->assertSame(substr(hash('sha256', 'LID-9'), 0, 16), $payload['lh']);
        $this->assertSame(7, $payload['uid']);
        $this->assertSame(1_800_000_060, $payload['exp']);
        $this->assertStringNotContainsString('LID-9', $t['ticket']);
        $this->assertDoesNotMatchRegularExpression('/[+\/=]/', $t['ticket']);
    }

    public function test_uid_is_optional_and_every_ticket_has_a_unique_jti(): void
    {
        $signer = new CobrowseTicketSigner;
        $a = $signer->verify($signer->mint('1', 'L')['ticket']);
        $b = $signer->verify($signer->mint('1', 'L')['ticket']);

        $this->assertArrayNotHasKey('uid', $a);
        $this->assertNotSame($a['jti'], $b['jti']);
        $this->assertNotSame($a['sid'], $b['sid']);
    }

    public function test_verify_rejects_tampering_a_wrong_secret_and_expiry(): void
    {
        $signer = new CobrowseTicketSigner;
        $ticket = $signer->mint('1', 'L', null, 1_000)['ticket'];

        $this->assertNotNull($signer->verify($ticket, 1_059));
        $this->assertNull($signer->verify($ticket, 1_060));
        [$body, $sig] = explode('.', $ticket);
        $this->assertNull($signer->verify($this->b64('{"tid":"2","exp":9999999999}').'.'.$sig, 1_000));
        $this->assertNull($signer->verify($body, 1_000));

        config(['services.uber_auth.secret' => 'another-secret']);
        $this->assertNull($signer->verify($ticket, 1_000));
    }
}
