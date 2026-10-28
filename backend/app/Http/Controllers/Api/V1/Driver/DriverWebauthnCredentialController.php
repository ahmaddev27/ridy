<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Http\Controllers\Api\V1\WebauthnCredentialController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A driver's passkeys — the dashboard controller verbatim (same registrar,
 * same shapes: `{ceremony_id, options}`, 201 `{data}`, `{data: [...]}`, 204),
 * mounted behind `auth:driver` + `driver.account` + `driver.active`, with
 * one difference: starting an enrolment asks for no password. A driver has
 * none — their session comes from a freshly emailed code — so the step-up
 * the dashboard needs (B2) has nothing to check here.
 */
class DriverWebauthnCredentialController extends WebauthnCredentialController
{
    public function registerOptions(Request $request): JsonResponse
    {
        return response()->json($this->registrar->start($request->user()));
    }
}
