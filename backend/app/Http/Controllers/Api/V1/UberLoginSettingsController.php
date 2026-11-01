<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\PasswordlessLoginSettings;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Per-company options of the passwordless Uber login (docs/27, variant B): the Uber account
 * email, the automatic-code / automatic-re-login switches and the secret inbound address
 * the company forwards Uber's code email to. Behind the same feature gate and
 * `connections.manage` as the login itself.
 */
class UberLoginSettingsController extends Controller
{
    public function __construct(private readonly PasswordlessLoginSettings $settings) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->settings->show($request->user()->tenant)]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['sometimes', 'nullable', 'email:rfc', 'max:255'],
            'auto_code' => ['sometimes', 'boolean'],
            'auto_relogin' => ['sometimes', 'boolean'],
        ]);
        $tenant = $request->user()->tenant;

        if ($this->needsInboundAddress($data) && ! $this->settings->inboundConfigured($tenant)) {
            return response()->json([
                'message' => 'Create the inbound address first.',
                'errors' => ['auto_code' => ['inbound_address_required']],
            ], 422);
        }
        $this->settings->update($tenant, $data);

        return response()->json(['data' => $this->settings->show($tenant->refresh())]);
    }

    /** Creates a new secret address (the old one stops working). Shown once: only its hash is kept. */
    public function rotateInboundAddress(Request $request): JsonResponse
    {
        $address = $this->settings->rotateInboundAddress($request->user()->tenant);

        return response()->json(['data' => ['inbound_address' => $address]]);
    }

    /** @param  array<string, mixed>  $data */
    private function needsInboundAddress(array $data): bool
    {
        return ($data['auto_code'] ?? false) === true || ($data['auto_relogin'] ?? false) === true;
    }
}
