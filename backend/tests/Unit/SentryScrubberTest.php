<?php

namespace Tests\Unit;

use App\Support\SentryScrubber;
use Illuminate\Database\QueryException;
use PDOException;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Sentry\Event;
use Sentry\EventHint;
use Sentry\ExceptionDataBag;

class SentryScrubberTest extends TestCase
{
    public function test_request_secrets_are_scrubbed(): void
    {
        $event = Event::createEvent();
        $event->setRequest([
            'url' => 'https://reidey.de/api/v1/internal/dispatch/sessions/1/cookies',
            'headers' => ['X-Dispatch-Secret' => ['s3cret'], 'Authorization' => ['Bearer 1|abc'], 'Accept' => ['application/json']],
            'cookies' => ['reidey_session' => 'xyz'],
            'data' => [
                'email' => 'a@b.de', 'password' => 'hunter22', 'otp' => '123456',
                'cookies' => [['name' => 'sid', 'value' => 'uber-session']],
            ],
        ]);

        $request = SentryScrubber::beforeSend($event)->getRequest();

        $this->assertArrayNotHasKey('cookies', $request);
        $this->assertSame('[redacted]', $request['headers']['X-Dispatch-Secret']);
        $this->assertSame('[redacted]', $request['headers']['Authorization']);
        $this->assertSame(['application/json'], $request['headers']['Accept']);
        $this->assertSame('[redacted]', $request['data']['password']);
        $this->assertSame('[redacted]', $request['data']['otp']);
        $this->assertSame('[redacted]', $request['data']['cookies']);
        $this->assertSame('a@b.de', $request['data']['email']);
    }

    public function test_query_exception_bindings_are_removed(): void
    {
        $exception = new QueryException(
            'mysql',
            'update tenants set proxy_url = ? where id = ?',
            ['http://user:pass@proxy:8080', 7],
            new PDOException("SQLSTATE[23000]: Integrity constraint violation: 1062 Duplicate entry 'boss@acme.de' for key 'users_email_unique'"),
        );

        $event = Event::createEvent();
        $event->setExceptions([new ExceptionDataBag($exception)]);
        $this->assertStringContainsString('user:pass', $event->getExceptions()[0]->getValue());

        SentryScrubber::beforeSend($event, EventHint::fromArray(['exception' => $exception]));
        $value = $event->getExceptions()[0]->getValue();

        $this->assertStringNotContainsString('user:pass', $value);
        $this->assertStringNotContainsString('boss@acme.de', $value);
        $this->assertStringContainsString('update tenants set proxy_url = ?', $value);
    }

    public function test_other_exceptions_are_left_alone(): void
    {
        $event = Event::createEvent();
        $event->setExceptions([new ExceptionDataBag(new RuntimeException('boom'))]);

        SentryScrubber::beforeSend($event, EventHint::fromArray(['exception' => new RuntimeException('boom')]));

        $this->assertSame('boom', $event->getExceptions()[0]->getValue());
    }
}
