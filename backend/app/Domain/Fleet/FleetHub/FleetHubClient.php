<?php

namespace App\Domain\Fleet\FleetHub;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Earnings\UberEarningsException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * The ONE request path to Fleet Hub's GraphQL endpoint: a company's stored
 * supplier jar, through that company's residential proxy (Uber blocks
 * datacenter IPs). Earnings, vehicles and any later pull share it.
 *
 * Read-only on purpose: Set-Cookie answers are NOT written back. The dispatch
 * daemon owns the jar and treats a jar that changed under it as a re-link,
 * tearing its stream down; its own 24/7 Fleet Hub polls keep the session warm.
 *
 * A 401/403 is reported as `uber_session_rejected` and never retried here.
 */
class FleetHubClient
{
    public const TIMEOUT_SECONDS = 20;

    /**
     * @param  array<string, mixed>  $variables  epoch-ms values MUST already be strings
     * @return array<string, mixed> the decoded body, guaranteed free of GraphQL errors
     *
     * @throws UberEarningsException
     */
    public function query(UberFleetSession $session, string $proxyUrl, string $operation, string $document, array $variables): array
    {
        $response = $this->send($session, $proxyUrl, '/graphql', [
            'operationName' => $operation,
            'query' => $document,
            'variables' => $variables,
        ]);

        $json = $response->json();
        if (! is_array($json) || ! empty($json['errors'])) {
            throw new UberEarningsException('uber_graphql_error', 'Fleet Hub returned a GraphQL error.');
        }

        return $json;
    }

    /**
     * A REST POST on Fleet Hub (e.g. /api/GetEarnerMetrics), same auth, proxy,
     * timeout and 401/403 mapping as {@see query()}.
     *
     * @param  array<string, mixed>  $body
     * @return array<string, mixed> the decoded JSON body
     *
     * @throws UberEarningsException
     */
    public function post(UberFleetSession $session, string $proxyUrl, string $path, array $body): array
    {
        $json = $this->send($session, $proxyUrl, $path, $body)->json();
        if (! is_array($json)) {
            throw new UberEarningsException('unexpected_response', 'Fleet Hub answered with a non-JSON body.');
        }

        return $json;
    }

    /**
     * @param  array<string, mixed>  $body
     *
     * @throws UberEarningsException
     */
    private function send(UberFleetSession $session, string $proxyUrl, string $path, array $body): Response
    {
        try {
            $response = Http::withHeaders($this->headers($session))
                ->withOptions(['proxy' => $proxyUrl])
                ->timeout(self::TIMEOUT_SECONDS)
                ->acceptJson()
                ->asJson()
                ->post(rtrim((string) config('services.uber.supplier_base_url'), '/').$path, $body);
        } catch (ConnectionException) {
            throw new UberEarningsException('uber_unreachable', 'Fleet Hub did not answer.');
        }

        if (in_array($response->status(), [401, 403], true)) {
            throw new UberEarningsException('uber_session_rejected', 'Fleet Hub refused the stored session.', 409);
        }
        if (! $response->successful()) {
            throw new UberEarningsException('uber_error', 'Fleet Hub answered '.$response->status().'.');
        }

        return $response;
    }

    /** @return array<string, string> */
    private function headers(UberFleetSession $session): array
    {
        $cookie = collect($session->supplier_cookies ?? [])
            ->filter(fn ($c) => is_array($c) && isset($c['name'], $c['value']))
            ->map(fn ($c) => $c['name'].'='.$c['value'])
            ->implode('; ');

        return [
            'accept-language' => 'de-DE,de;q=0.9',
            'x-uber-locale' => 'de-DE',
            'x-uber-client-name' => 'vs_dispatch',
            'x-uber-client-session' => (string) Str::uuid(),
            'x-uber-client-version' => '1.0.0',
            'x-uber-device' => 'web',
            'x-uber-device-id' => 'vs_dispatch-'.Str::uuid(),
            'x-csrf-token' => 'x',
            'cookie' => $cookie,
        ];
    }
}
