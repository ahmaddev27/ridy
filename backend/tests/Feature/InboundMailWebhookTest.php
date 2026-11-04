<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Inbound\InboundMailHandler;
use App\Domain\Dispatch\PasswordlessLoginSettings;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery\MockInterface;
use Tests\TestCase;

/** The HTTPS receive path (SendGrid Inbound Parse) in front of InboundMailHandler. */
class InboundMailWebhookTest extends TestCase
{
    use RefreshDatabase;

    private const URL = '/api/v1/inbound-mail/webhook';

    private string $address;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.passwordless_login.enabled' => true,
            'services.passwordless_login.inbound_domain' => 'in.reidey.de',
            'services.inbound_mail.webhook_secret' => 'hook-secret',
        ]);
        $tenant = Tenant::create([
            'name' => 'Acme', 'country' => 'DE', 'status' => 'active', 'activated_at' => now(),
            'settings' => ['passwordless_login' => ['enabled' => true]],
        ]);
        $this->address = app(PasswordlessLoginSettings::class)->ensureInboundAddress($tenant);
    }

    private function hook(array $fields, string $query = '?token=hook-secret')
    {
        return $this->post(self::URL.$query, $fields);
    }

    private function spyHandler(string $outcome = 'submitted'): MockInterface
    {
        return $this->mock(InboundMailHandler::class, fn (MockInterface $m) => $m->shouldReceive('handle')->andReturn($outcome));
    }

    public function test_rejects_without_or_with_a_wrong_secret(): void
    {
        $this->spyHandler()->shouldNotReceive('handle');

        $this->hook(['to' => $this->address], '')->assertUnauthorized();
        $this->hook(['to' => $this->address], '?token=nope')->assertUnauthorized();
    }

    public function test_a_blank_configured_secret_rejects_everything(): void
    {
        config(['services.inbound_mail.webhook_secret' => '']);

        $this->hook(['to' => $this->address], '?token=')->assertUnauthorized();
    }

    public function test_the_header_secret_is_accepted_too(): void
    {
        $this->spyHandler();

        $this->withHeaders(['X-Inbound-Secret' => 'hook-secret'])
            ->post(self::URL, ['to' => $this->address, 'email' => "Subject: x\r\n\r\nbody"])
            ->assertOk()->assertJsonPath('data.outcome', 'submitted');
    }

    public function test_hands_the_raw_message_and_recipient_to_the_existing_handler(): void
    {
        $raw = "From: Uber <admin@uber.com>\r\nSubject: Do not share: 0033\r\nMessage-ID: <a@b>\r\n\r\nhi";
        $this->mock(InboundMailHandler::class, function (MockInterface $m) use ($raw) {
            $m->shouldReceive('handle')->once()->with($raw, $this->address)->andReturn('submitted');
        });

        $this->hook([
            'to' => 'Reidey <'.$this->address.'>',
            'envelope' => json_encode(['to' => [$this->address], 'from' => 'x@y.de']),
            'email' => $raw,
        ])->assertOk()->assertJsonPath('data.outcome', 'submitted');
    }

    public function test_without_a_raw_email_a_minimal_message_is_rebuilt_from_headers_and_text(): void
    {
        $this->mock(InboundMailHandler::class, function (MockInterface $m) {
            $m->shouldReceive('handle')->once()->withArgs(function (string $raw, string $rcpt) {
                return $rcpt === $this->address
                    && str_contains($raw, 'Message-Id: <m1@uber.test>')
                    && str_contains($raw, 'Subject: Do not share: 0033')
                    && ! str_contains($raw, 'X-Secret')
                    && str_ends_with($raw, "\r\n\r\nverification code 0033");
            })->andReturn('submitted');
        });

        $this->hook([
            'to' => $this->address,
            'headers' => "Message-ID: <m1@uber.test>\nX-Secret: leak\nSubject: Do not share: 0033\n",
            'text' => 'verification code 0033',
        ])->assertOk();
    }

    public function test_a_foreign_recipient_never_reaches_the_handler(): void
    {
        $this->spyHandler()->shouldNotReceive('handle');

        $this->hook(['to' => 'someone@in.reidey.de', 'email' => 'Subject: x'])
            ->assertOk()->assertJsonPath('data.outcome', 'unknown_address');
    }

    public function test_an_infrastructure_failure_answers_503_without_details(): void
    {
        $this->mock(InboundMailHandler::class, fn (MockInterface $m) => $m->shouldReceive('handle')->andThrow(new \RuntimeException('db down: ops@acme.de')));

        $this->hook(['to' => $this->address, 'email' => 'Subject: x'])
            ->assertStatus(503)->assertJsonMissing(['ops@acme.de'])->assertJsonPath('message', 'Temporarily unavailable.');
    }

    public function test_oversize_fields_are_rejected(): void
    {
        $this->hook(['to' => $this->address, 'email' => str_repeat('a', 262145)])->assertUnprocessable();
    }
}
