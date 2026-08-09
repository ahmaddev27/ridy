<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Admin\StoreCompanyUserRequest;
use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Hash;

/**
 * Super-admin management of a company's manager accounts.
 */
class CompanyUserController extends Controller
{
    public function index(Tenant $tenant): AnonymousResourceCollection
    {
        $users = User::where('tenant_id', $tenant->id)->orderBy('name')->get();

        return UserResource::collection($users);
    }

    public function store(StoreCompanyUserRequest $request, Tenant $tenant): JsonResponse
    {
        $user = User::create([
            'name' => $request->string('name'),
            'email' => $request->string('email'),
            'password' => Hash::make($request->string('password')),
            'tenant_id' => $tenant->id,
        ]);
        $user->assignRole('fleet_manager');

        return response()->json(['data' => new UserResource($user)], 201);
    }

    public function resetPassword(Request $request, Tenant $tenant, User $user): JsonResponse
    {
        abort_unless($user->tenant_id === $tenant->id, 404);

        $data = $request->validate(['password' => ['required', 'string', 'min:8']]);

        $user->update(['password' => Hash::make($data['password'])]);
        // A reset should log the user out everywhere.
        $user->tokens()->delete();

        return response()->json(['data' => ['reset' => true]]);
    }
}
