<?php

namespace App\Support;

use Illuminate\Database\QueryException;
use Sentry\Event;
use Sentry\EventHint;

/**
 * Keeps secrets out of Sentry (a third party). Request bodies are not captured
 * at all (max_request_body_size = never — they carry Uber cookie jars, passwords,
 * OTPs, rider addresses), and this before_send hook additionally:
 *  - drops cookies and redacts credential headers (X-Dispatch-Secret, Authorization, …);
 *  - redacts any body / query field that still made it in under a sensitive key;
 *  - replaces a QueryException's message (which embeds the SQL *bindings*, e.g. a
 *    proxy URL with credentials or an OTP) with the placeholder SQL.
 */
class SentryScrubber
{
    private const REDACTED = '[redacted]';

    private const SENSITIVE_HEADERS = [
        'authorization', 'cookie', 'set-cookie', 'x-dispatch-secret', 'x-xsrf-token', 'x-csrf-token',
        'cf-connecting-ip', 'x-forwarded-for', 'x-real-ip',
    ];

    private const SENSITIVE_KEY = '/pass|otp|code|token|secret|cookie|session|proxy|authorization|value/i';

    /** Wire the scrubber in unless an explicit Sentry config already sets these. */
    public static function configure(): void
    {
        if (config('sentry.before_send') === null) {
            config(['sentry.before_send' => [self::class, 'beforeSend']]);
        }
        if (config('sentry.max_request_body_size') === null) {
            config(['sentry.max_request_body_size' => 'never']);
        }
    }

    public static function beforeSend(Event $event, ?EventHint $hint = null): ?Event
    {
        $event->setRequest(self::scrubRequest($event->getRequest()));

        $exception = $hint?->exception;
        if ($exception instanceof QueryException) {
            self::stripBindings($event, $exception);
        }

        return $event;
    }

    /**
     * @param  array<string, mixed>  $request
     * @return array<string, mixed>
     */
    private static function scrubRequest(array $request): array
    {
        unset($request['cookies']);

        if (isset($request['headers']) && is_array($request['headers'])) {
            foreach ($request['headers'] as $name => $value) {
                if (in_array(strtolower((string) $name), self::SENSITIVE_HEADERS, true)) {
                    $request['headers'][$name] = self::REDACTED;
                }
            }
        }

        foreach (['data', 'query_string'] as $part) {
            if (isset($request[$part]) && is_array($request[$part])) {
                $request[$part] = self::redact($request[$part]);
            }
        }

        return $request;
    }

    /**
     * @param  array<mixed>  $data
     * @return array<mixed>
     */
    private static function redact(array $data): array
    {
        foreach ($data as $key => $value) {
            if (is_string($key) && preg_match(self::SENSITIVE_KEY, $key) === 1) {
                $data[$key] = self::REDACTED;
            } elseif (is_array($value)) {
                $data[$key] = self::redact($value);
            }
        }

        return $data;
    }

    private static function stripBindings(Event $event, QueryException $exception): void
    {
        // The driver's own message names the failing column but, for a duplicate
        // key, also echoes the value (often an email) — mask that part.
        $driverMessage = (string) ($exception->getPrevious()?->getMessage() ?? 'SQLSTATE['.$exception->getCode().']');
        $driverMessage = (string) preg_replace("/Duplicate entry '.*?' for key/s", "Duplicate entry '?' for key", $driverMessage);

        $safe = sprintf('%s (Connection: %s, SQL: %s)', $driverMessage, $exception->getConnectionName(), $exception->getSql());

        foreach ($event->getExceptions() as $bag) {
            if (str_contains($bag->getValue(), 'SQL:')) {
                $bag->setValue($safe);
            }
        }
    }
}
