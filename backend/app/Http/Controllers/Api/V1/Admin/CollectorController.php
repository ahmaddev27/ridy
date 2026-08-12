<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Collections\Models\Collector;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Spatie\Permission\Models\Role;

/**
 * Super-admin management of cash collectors. A collector may optionally have a
 * login (a "reseller" User) so they can sign in and issue activation codes.
 */
class CollectorController extends Controller
{
    public function index(): JsonResponse
    {
        $collectors = Collector::query()
            ->with('user:id,email')
            ->withCount('payments')
            ->withSum('payments as total_collected', 'amount')
            ->withMax('payments as last_paid_on', 'paid_on')
            ->orderBy('name')
            ->get()
            ->map(fn (Collector $c) => $this->present($c));

        return response()->json(['data' => $collectors]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, null);
        $collector = Collector::create(['name' => $data['name'], 'phone' => $data['phone'] ?? null, 'address' => $data['address'] ?? null]);
        $this->syncLogin($collector, $data['email'] ?? null, $data['password'] ?? null);

        return response()->json(['data' => $this->present($collector->fresh('user'))], 201);
    }

    public function update(Request $request, Collector $collector): JsonResponse
    {
        $data = $this->validated($request, $collector);
        $collector->update(['name' => $data['name'], 'phone' => $data['phone'] ?? null, 'address' => $data['address'] ?? null]);
        $this->syncLogin($collector, $data['email'] ?? null, $data['password'] ?? null);

        return response()->json(['data' => $this->present($collector->fresh('user'))]);
    }

    public function destroy(Collector $collector): JsonResponse
    {
        // Deleting would cascade the whole payment ledger — block it so financial
        // history is never lost by accident. The admin must clear payments first.
        if ($collector->payments()->exists()) {
            return response()->json(['message' => 'collector_has_payments'], 422);
        }

        $collector->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, ?Collector $collector): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:50'],
            'address' => ['nullable', 'string', 'max:500'],
            // Optional login for the reseller. Email must be unique across users
            // (ignoring this collector's own login when editing).
            'email' => ['nullable', 'email', 'max:255', Rule::unique('users', 'email')->ignore($collector?->user_id)],
            'password' => ['nullable', 'string', 'min:8'],
        ]);
    }

    /**
     * Create or update the collector's reseller login. A blank email leaves any
     * existing login untouched; a new login needs a password.
     */
    private function syncLogin(Collector $collector, ?string $email, ?string $password): void
    {
        if ($email === null || $email === '') {
            return;
        }

        $user = $collector->user;
        if ($user !== null) {
            $user->email = $email;
            if ($password) {
                $user->password = Hash::make($password);
            }
            $user->save();

            return;
        }

        $user = User::create([
            'name' => $collector->name,
            'email' => $email,
            'password' => Hash::make($password ?: Str::random(24)),
            'tenant_id' => null,
        ]);
        // Ensure the role exists even if the seeder hasn't been (re-)run on this env.
        Role::findOrCreate('reseller');
        $user->assignRole('reseller');
        $collector->update(['user_id' => $user->id]);
    }

    /** @return array<string, mixed> */
    private function present(Collector $c): array
    {
        return [
            'id' => $c->id,
            'name' => $c->name,
            'phone' => $c->phone,
            'address' => $c->address,
            'email' => $c->user?->email,
            'has_login' => $c->user_id !== null,
            'payments_count' => (int) ($c->payments_count ?? 0),
            'total_collected' => (float) ($c->total_collected ?? 0),
            'last_paid_on' => $c->getAttribute('last_paid_on'),
        ];
    }
}
