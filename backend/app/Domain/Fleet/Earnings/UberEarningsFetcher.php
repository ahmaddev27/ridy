<?php

namespace App\Domain\Fleet\Earnings;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\FleetHub\FleetHubClient;

/**
 * Pulls getEarnerBreakdownsV2 from Fleet Hub with a company's stored supplier
 * jar, through that company's residential proxy (Uber blocks datacenter IPs).
 *
 * The request path (headers, proxy, auth-error mapping) lives in
 * {@see FleetHubClient}, which is read-only: Set-Cookie answers are never
 * written back to the jar the dispatch daemon owns.
 */
class UberEarningsFetcher
{
    public const MAX_PAGES = 50;

    private const OPERATION = 'getEarnerBreakdownsV2';

    public function __construct(private readonly FleetHubClient $client) {}

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
        return $this->client->query(
            $session,
            $proxyUrl,
            self::OPERATION,
            self::QUERY,
            $this->variables($session, $startMs, $endMs, $token),
        );
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
}
