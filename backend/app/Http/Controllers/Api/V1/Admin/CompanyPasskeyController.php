<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\PasskeyService;
use App\Domain\Dispatch\UberAuthClient;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/** Super-admin: ask uber-auth to register a software passkey for a company (docs/29). */
class CompanyPasskeyController extends Controller
{
    public function register(Tenant $tenant, PasskeyService $passkeys, UberAuthClient $uberAuth): JsonResponse
    {
        abort_unless($passkeys->isEnabledFor($tenant), 403, 'Passkey registration is not enabled for this company.');
        abort_unless($uberAuth->configured(), 503, 'Browser service not configured.');

        $result = $uberAuth->registerPasskey($tenant->id);

        return response()->json(['data' => ['status' => $result['status'] ?? 'error']]);
    }
}
