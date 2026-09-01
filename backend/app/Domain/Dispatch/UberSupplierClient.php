<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\UberFleetSession;
use Illuminate\Support\Facades\Http;

/**
 * Calls Uber's supplier API with a captured fleet session's cookies. Used for
 * on-demand roster pulls when the manager opens the Drivers page.
 */
class UberSupplierClient
{
    /**
     * @return array<int, array<string, mixed>> the data.drivers array (empty on failure)
     */
    public function getDrivers(UberFleetSession $session): array
    {
        $cookieHeader = collect($session->cookies ?? [])
            ->map(fn ($c) => ($c['name'] ?? '').'='.($c['value'] ?? ''))
            ->implode('; ');

        $base = rtrim((string) config('services.uber.supplier_base_url', 'https://fleethub.uber.com'), '/');

        $response = Http::withHeaders([
            'Cookie' => $cookieHeader,
            'Accept' => 'application/json',
            'x-uber-client-name' => 'supplier',
        ])->timeout(20)->get($base.'/api/getDrivers', ['localeCode' => 'en']);

        if (! $response->successful()) {
            return [];
        }

        return $response->json('data.drivers', []);
    }
}
