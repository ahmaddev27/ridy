<?php

namespace App\Domain\Fleet\Earnings;

use App\Domain\Dispatch\Models\UberFleetSession;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Pulls getEarnerBreakdownsV2 from Fleet Hub with a company's stored supplier
 * jar, through that company's residential proxy (Uber blocks datacenter IPs).
 *
 * Read-only on purpose: Set-Cookie answers are NOT written back. The dispatch
 * daemon owns the jar and treats a jar that changed under it as a re-link,
 * tearing its stream down; its own 24/7 Fleet Hub polls keep the session warm.
 */
class UberEarningsFetcher
{
    public const MAX_PAGES = 50;

    public const PAGE_TIMEOUT_SECONDS = 20;

    private const OPERATION = 'getEarnerBreakdownsV2';

    /** The document the Fleet Hub page itself sends; transcribed from the owner's script. */
    public const QUERY = <<<'GRAPHQL'
query getEarnerBreakdownsV2(
  $supplierUuid: ID!, $timeRange: OneOfTimeRange__Input,
  $driverListOrPageOptions: DriverListOrPagination, $driverList: [ID!],
  $pageOptions: PaginationOption__Input, $locale: String,
  $excludeAdjustmentItems: Boolean
) {
  getEarnerBreakdownsV2(
    supplierUuid: $supplierUuid timeRange: $timeRange
    driverListOrPageOptions: $driverListOrPageOptions driverList: $driverList
    pageOptions: $pageOptions locale: $locale
    excludeAdjustmentItems: $excludeAdjustmentItems
  ) {
    earnerEarningsBreakdowns {
      earnerUuid
      earnerMetadata { name }
      tripInfos { tripAttributeName value }
      netOutstanding { amountE5 currencyCode }
      earnings { categoryName amount { amountE5 currencyCode }
        children { categoryName amount { amountE5 }
          children { categoryName amount { amountE5 } } } }
      reimbursements { categoryName amount { amountE5 } }
      payouts { categoryName amount { amountE5 }
        children { categoryName amount { amountE5 } } }
      adjustmentsFromPreviousPeriods { categoryName amount { amountE5 }
        children { categoryName amount { amountE5 }
          children { categoryName amount { amountE5 }
            children { categoryName amount { amountE5 } } } } }
    }
    pageInfo { nextPageToken }
  }
}
GRAPHQL;

    /**
     * @return list<array<string, mixed>> every earner of the range, all pages
     *
     * @throws UberEarningsException
     */
    public function fetch(UberFleetSession $session, string $proxyUrl, int $startMs, int $endMs): array
    {
        $earners = [];
        $token = null;
        $seen = [];

        for ($page = 1; $page <= self::MAX_PAGES; $page++) {
            $body = $this->page($session, $proxyUrl, $startMs, $endMs, $token);
            $block = $body['data']['getEarnerBreakdownsV2'] ?? null;
            if (! is_array($block)) {
                throw new UberEarningsException('unexpected_response', 'No getEarnerBreakdownsV2 block in the answer.');
            }

            foreach ($block['earnerEarningsBreakdowns'] ?? [] as $earner) {
                if (is_array($earner)) {
                    $earners[] = $earner;
                }
            }

            $next = $block['pageInfo']['nextPageToken'] ?? null;
            if (! is_string($next) || $next === '' || isset($seen[$next])) {
                return $earners;
            }
            $seen[$next] = true;
            $token = $next;
        }

        // Stopping silently at the cap would hand back a partial week as a whole one.
        throw new UberEarningsException('too_many_pages', 'Page cap reached before Uber stopped paginating.');
    }

    /** @return array<string, mixed> */
    private function page(UberFleetSession $session, string $proxyUrl, int $startMs, int $endMs, ?string $token): array
    {
        try {
            $response = Http::withHeaders($this->headers($session))
                ->withOptions(['proxy' => $proxyUrl])
                ->timeout(self::PAGE_TIMEOUT_SECONDS)
                ->acceptJson()
                ->asJson()
                ->post(rtrim((string) config('services.uber.supplier_base_url'), '/').'/graphql', [
                    'operationName' => self::OPERATION,
                    'query' => self::QUERY,
                    'variables' => $this->variables($session, $startMs, $endMs, $token),
                ]);
        } catch (ConnectionException) {
            throw new UberEarningsException('uber_unreachable', 'Fleet Hub did not answer.');
        }

        if (in_array($response->status(), [401, 403], true)) {
            throw new UberEarningsException('uber_session_rejected', 'Fleet Hub refused the stored session.', 409);
        }
        if (! $response->successful()) {
            throw new UberEarningsException('uber_error', 'Fleet Hub answered '.$response->status().'.');
        }

        $json = $response->json();
        if (! is_array($json) || ! empty($json['errors'])) {
            throw new UberEarningsException('uber_graphql_error', 'Fleet Hub returned a GraphQL error.');
        }

        return $json;
    }

    /** @return array<string, mixed> */
    public function variables(UberFleetSession $session, int $startMs, int $endMs, ?string $token): array
    {
        return [
            'supplierUuid' => $session->uber_org_uuid,
            'timeRange' => [
                'unixMilliOrDate' => 'Unix_Time_Range',
                // STRINGS, like the Fleet Hub page itself sends. A Unix
                // millisecond stamp is about 1.76e12 and GraphQL's Int is a
                // signed 32-bit number capped at 2147483647, so a JSON number
                // here cannot be coerced whatever the field's declared type --
                // and the gateway answers 400 with no GraphQL error body to
                // read. This was sent as int until 13.10.2026 and the first
                // real call to Uber is what found it.
                'startTimeUnixMillis' => (string) $startMs,
                'endTimeUnixMillis' => (string) $endMs,
            ],
            'driverListOrPageOptions' => 'Page_Options',
            'driverList' => null,
            // The empty string is the FIRST page, not null: `pageToken` inside
            // PaginationOption__Input takes a string, and the page sends '' to
            // start. Null is a second coercion fault in the same request.
            'pageOptions' => ['pageSize' => 10, 'pageToken' => $token ?? ''],
            'excludeAdjustmentItems' => true,
        ];
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
