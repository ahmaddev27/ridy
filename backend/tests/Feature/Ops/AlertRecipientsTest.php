<?php

namespace Tests\Feature\Ops;

use App\Domain\Notifications\Jobs\SendRenderedMail;
use App\Domain\Ops\AlertService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Who ops alerts reach.
 *
 * This is the one notification path that tells the operator a company's offers
 * have stopped, so its failure mode is the worst kind: silent. ALERT_EMAIL used to
 * be passed through as a single string, which Symfony Mailer reads as ONE address —
 * so adding a second recipient to get more eyes on broken sessions silently
 * delivered to NEITHER. These tests pin the parsing that fixed it.
 */
class AlertRecipientsTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_single_address_still_works(): void
    {
        config(['services.alerts.email' => 'ops@reidey.de']);

        $this->assertSame(['ops@reidey.de'], AlertService::recipients());
    }

    /**
     * @param  string  $raw  what the operator put in the secret
     */
    #[DataProvider('separators')]
    public function test_several_addresses_are_split_however_they_were_separated(string $raw): void
    {
        config(['services.alerts.email' => $raw]);

        $this->assertSame(['a@reidey.de', 'b@reidey.de'], AlertService::recipients(), $raw);
    }

    /** @return array<string, array{string}> */
    public static function separators(): array
    {
        return [
            'comma' => ['a@reidey.de,b@reidey.de'],
            'comma and space' => ['a@reidey.de, b@reidey.de'],
            'semicolon' => ['a@reidey.de;b@reidey.de'],
            'space' => ['a@reidey.de b@reidey.de'],
            'newline' => ["a@reidey.de\nb@reidey.de"],
            'padded' => ['  a@reidey.de ,  b@reidey.de  '],
        ];
    }

    public function test_an_unset_or_blank_address_means_no_email_not_a_broken_one(): void
    {
        foreach ([null, '', '   ', ',', ' , ; '] as $raw) {
            config(['services.alerts.email' => $raw]);

            $this->assertSame([], AlertService::recipients(), var_export($raw, true));
        }
    }

    public function test_a_typo_drops_only_that_address(): void
    {
        // A mistyped entry must not take the whole alert down with it: the point of
        // a second recipient is redundancy, so one bad address cannot cost both.
        config(['services.alerts.email' => 'good@reidey.de, not-an-email, also@reidey.de']);

        $this->assertSame(['good@reidey.de', 'also@reidey.de'], AlertService::recipients());
    }

    public function test_a_repeated_address_is_not_mailed_twice(): void
    {
        config(['services.alerts.email' => 'ops@reidey.de, ops@reidey.de']);

        $this->assertSame(['ops@reidey.de'], AlertService::recipients());
    }

    public function test_an_opened_alert_is_queued_to_every_recipient(): void
    {
        Queue::fake();
        config(['services.alerts.email' => 'a@reidey.de, b@reidey.de']);

        app(AlertService::class)->open('session_relink:1', 'session_relink', 'Uber session broken for Acme');

        Queue::assertPushed(SendRenderedMail::class, function (SendRenderedMail $job) {
            // An ARRAY, not a joined string — that distinction is the whole bug.
            return $job->to === ['a@reidey.de', 'b@reidey.de']
                && str_contains($job->subject, 'Uber session broken for Acme');
        });
    }

    public function test_nothing_is_queued_when_no_address_is_configured(): void
    {
        Queue::fake();
        config(['services.alerts.email' => null]);

        app(AlertService::class)->open('session_relink:2', 'session_relink', 'Uber session broken for Globex');

        // Still recorded as an incident and a log line; just nobody to mail.
        Queue::assertNotPushed(SendRenderedMail::class);
        $this->assertDatabaseHas('alert_incidents', ['key' => 'session_relink:2']);
    }
}
