<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Audit\AuditLogger;
use App\Domain\Auth\OtpGuard;
use App\Domain\Auth\PasswordCheck;
use App\Domain\Auth\ReviewLogin;
use App\Domain\Auth\Webauthn\PasskeyAuthenticator;
use App\Domain\Auth\Webauthn\PasskeyScope;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\DriverInvitationService;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Domain\Notifications\SendTemplatedMail;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use App\Http\Middleware\EnsureFleetOwner;
use App\Http\Requests\Api\V1\WebauthnCeremonyRequest;
use App\Models\User;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

/**
 * Authentication for the mobile driver app. Drivers activate an emailed
 * invitation (set a password), then sign in for a Sanctum bearer token. Kept
 * separate from the manager AuthController: different guard, no SPA session.
 */
class DriverAuthController extends Controller
{
    private const OTP_TTL_MINUTES = 10;

    /** The single ability a fleet-owner app token carries (see EnsureDashboardToken). */
    private const OWNER_APP_ABILITY = 'fleet:read';

    public function __construct(
        private readonly DriverInvitationService $invitations,
        private readonly OtpGuard $otp,
        private readonly ReviewLogin $reviewLogin,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Passwordless sign-in step 1: email a 6-digit code. Works for a driver
     * (invited or activated) or a fleet owner/manager. Never discloses whether
     * an account exists.
     */
    public function loginRequest(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email']]);

        // The code only ever goes to the address STORED on the account. MySQL's
        // accent-insensitive collation also matches look-alikes ("gmäil.com"),
        // which an attacker can register and read.
        $account = $this->resolveAppAccount($data['email']);
        if ($account !== null && OtpGuard::sameEmail((string) $account->email, $data['email'])) {
            $reset = $this->otp->issueReset((string) $account->email, self::OTP_TTL_MINUTES);

            SendTemplatedMail::to((string) $account->email, 'driver_login_otp', ['name' => (string) $account->name, 'otp' => $reset->otp]);
        }

        return response()->json(['data' => ['sent' => true]]);
    }

    /**
     * Passwordless sign-in step 2: verify the code and issue a token. A driver is
     * activated on first successful code; a fleet owner signs in read-only. No
     * password is ever set or checked.
     */
    public function loginVerify(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'otp' => ['required', 'digits:6'],
        ]);

        // App-store reviewer sign-in: one admin-configured email + fixed code, OFF
        // unless turned on (`app-review:login`). Every other sign-in falls through
        // to the emailed code below.
        if ($this->reviewLogin->matches($data['email'], $data['otp'])) {
            // Resolve by the CONFIGURED address, not the typed one (same idea as the
            // OTP: never trust a look-alike the collation might match).
            $account = $this->resolveAppAccount((string) $this->reviewLogin->email());
            if ($account !== null && OtpGuard::sameEmail((string) $account->email, $data['email'])) {
                $this->guardSuspendedTenant($account->loadMissing('tenant')->tenant);
                Log::warning('auth.review_login_used', ['account' => class_basename($account).'#'.$account->id, 'ip' => $request->ip()]);
                rescue(fn () => $this->audit->log('auth.review_login', $account, ['ip' => $request->ip()], $account->tenant_id), report: false);

                return $this->completeSignIn($account);
            }
        }

        $reset = $this->otp->verifyReset($data['email'], $data['otp']);

        $account = $this->resolveAppAccount($reset->email);
        if ($account === null || ! OtpGuard::sameEmail((string) $account->email, $data['email'])) {
            $this->otp->consume($reset);
            // Same answer as a wrong code: verify must not reveal account existence.
            throw ValidationException::withMessages(['otp' => 'otp_incorrect']);
        }

        $this->guardSuspendedTenant($account->loadMissing('tenant')->tenant);
        // Spend the code exactly once before minting — a concurrent second correct
        // submit gets otp_incorrect instead of a second token.
        $this->otp->consume($reset);

        return $this->completeSignIn($account);
    }

    /**
     * Passkey sign-in, step 1 (public, docs/22 §4.6): the options name no
     * account and list no credentials — the authenticator offers what it holds
     * for the rpId. Cookie-less: the ceremony is parked in the cache under the
     * one-time id the app echoes back.
     */
    public function passkeyLoginOptions(PasskeyAuthenticator $passkeys): JsonResponse
    {
        return response()->json($passkeys->start());
    }

    /**
     * Passkey sign-in, step 2 (public): a verified assertion is exchanged for
     * the very token `loginVerify` mints, behind the very same gate. Only a
     * credential enrolled for the APP matches; a dashboard passkey reads as
     * unknown. Every refusal is the one generic 422.
     */
    public function passkeyLogin(WebauthnCeremonyRequest $request, PasskeyAuthenticator $passkeys): JsonResponse
    {
        $account = $passkeys->authenticate(
            $request->ceremonyId(),
            $request->credential(),
            [Driver::class, User::class],
            PasskeyScope::App,
        );

        return $account instanceof Driver
            ? $this->signInDriverByPasskey($account)
            : $this->signInOwnerByPasskey($account);
    }

    /**
     * The emailed code's identity rule, re-applied: the address on the row must
     * still resolve to THIS driver. Were it meanwhile pointed at another
     * company's owner/manager (resolveAppAccount hands such an address to the
     * owner, unless the driver claimed it first), a passkey enrolled earlier
     * must not keep capturing that owner's app sign-in.
     */
    private function signInDriverByPasskey(Driver $driver): JsonResponse
    {
        if (! $this->driverIdentityHolds($driver)) {
            throw PasskeyAuthenticator::refusal();
        }

        $this->guardSuspendedTenant($driver->loadMissing('tenant')->tenant);

        return $this->completeSignIn($driver);
    }

    /**
     * A driver row still resolves to itself by its own email. A linked owner-driver
     * with no email of its own is identified by the owner's address instead.
     */
    private function driverIdentityHolds(Driver $driver): bool
    {
        if (filled($driver->email)) {
            $resolved = $this->resolveAppAccount((string) $driver->email);

            return $resolved instanceof Driver && $resolved->is($driver);
        }

        $owner = $driver->user_id !== null ? $driver->user : null;
        if (! $owner instanceof User || ! filled($owner->email) || ! $driver->adminCapable()) {
            return false;
        }
        $resolved = $this->resolveAppAccount((string) $owner->email);

        return $resolved instanceof User && $resolved->is($owner);
    }

    /**
     * The same rule for an owner/manager: the address must still resolve to
     * THIS user (a driver of the same address may have claimed it since), and
     * they must still hold an owner role in a company — a demoted user's
     * passkey is dead. Mints the same read-only `fleet:read` token as the code.
     */
    private function signInOwnerByPasskey(User $owner): JsonResponse
    {
        $resolved = filled($owner->email) ? $this->resolveAppAccount((string) $owner->email) : null;
        if (! $resolved instanceof User || ! $resolved->is($owner)) {
            throw PasskeyAuthenticator::refusal();
        }

        if ($owner->tenant_id === null || ! $owner->hasAnyRole(EnsureFleetOwner::ROLES)) {
            throw PasskeyAuthenticator::refusal();
        }

        $this->guardSuspendedTenant($owner->loadMissing('tenant')->tenant);

        return $this->completeSignIn($owner);
    }

    /**
     * Mint the app token for a verified account. An owner linked to a driver row
     * signs in AS that driver (with admin capability); an unlinked owner keeps the
     * read-only fleet:read token.
     */
    private function completeSignIn(Driver|User $account): JsonResponse
    {
        if ($account instanceof User) {
            $linked = $this->linkedDriverFor($account);
            if ($linked === null) {
                return $this->ownerTokenResponse($account);
            }
            $account = $linked;
        }

        $account->forceFill([
            'activated_at' => $account->activated_at ?? now(),
            'invite_token' => null,
            'last_login_at' => now(),
        ])->save();

        return $this->tokenResponse($account);
    }

    /** The driver row an owner is linked to, if they still qualify (role, tenant, not suspended). */
    private function linkedDriverFor(User $owner): ?Driver
    {
        if ($owner->tenant_id === null || ! $owner->hasAnyRole(EnsureFleetOwner::ROLES)) {
            return null;
        }

        $driver = Driver::withoutGlobalScopes()
            ->where('tenant_id', $owner->tenant_id)
            ->where('user_id', $owner->id)
            ->where('is_manager', true)
            ->first();

        if ($driver === null || $driver->loadMissing('tenant')->tenant?->stateReason() !== null) {
            return null;
        }

        return $driver;
    }

    /**
     * Which app identity an email signs into. A driver row normally wins, EXCEPT
     * when the email is also an owner/manager of a DIFFERENT company: a driver's
     * email is set by that company's manager, so another tenant could otherwise
     * "claim" an owner's address and capture their app sign-in.
     */
    private function resolveAppAccount(string $email): Driver|User|null
    {
        $driver = Driver::withoutGlobalScopes()->where('email', $email)->first();
        $owner = $this->findOwnerByEmail($email);

        if ($driver !== null && ($owner === null || $owner->tenant_id === $driver->tenant_id || $this->claimedBefore($driver, $owner))) {
            return $driver;
        }

        return $owner;
    }

    /**
     * A real dual-role person (drives for one fleet, owns/manages another) keeps
     * signing in as the driver when they had already activated that driver
     * account before the owner account existed — no other tenant can have
     * squatted an owner address that did not exist yet.
     */
    private function claimedBefore(Driver $driver, User $owner): bool
    {
        return $driver->activated_at !== null
            && $owner->created_at !== null
            && $driver->activated_at->lt($owner->created_at);
    }

    /** Preview an invitation so the activation screen can greet the driver. */
    public function invite(string $token): JsonResponse
    {
        $driver = $this->invitations->findByToken($token);
        if ($driver === null) {
            return response()->json(['message' => 'invite_invalid'], 404);
        }

        return response()->json([
            'data' => [
                'driver_name' => $driver->name,
                'company_name' => $driver->tenant?->name,
                'email' => $driver->email,
            ],
        ]);
    }

    /** Consume an invitation: set the password and issue a token. */
    public function activate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string'],
            'password' => ['required', 'string', 'min:8'],
        ]);

        $driver = $this->invitations->findByToken($data['token']);
        if ($driver === null) {
            return response()->json(['message' => 'invite_invalid'], 404);
        }

        $this->guardSuspended($driver);
        $this->invitations->activate($driver, $data['password']);

        return $this->tokenResponse($driver);
    }

    /**
     * Email + password sign-in. The same screen serves two identities: a driver
     * (guard `driver`), or a company owner/manager signing in with their
     * dashboard credentials to monitor the whole fleet read-only.
     */
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $driver = Driver::withoutGlobalScopes()->where('email', $data['email'])->first();
        if ($driver !== null && $driver->activated_at !== null && PasswordCheck::matches($driver->password, $data['password'])) {
            $this->guardSuspendedTenant($driver->loadMissing('tenant')->tenant);
            $driver->forceFill(['last_login_at' => now()])->save();

            return $this->tokenResponse($driver);
        }

        $owner = $this->findOwner($data['email'], $data['password']);
        if ($owner !== null) {
            $this->guardSuspendedTenant($owner->loadMissing('tenant')->tenant);

            return $this->ownerTokenResponse($owner);
        }

        throw ValidationException::withMessages(['email' => [__('auth.failed')]]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->profile($request->user())]);
    }

    /**
     * The driver edits their own name and app language. The app is passwordless,
     * so a bearer token can no longer set a password (a stolen token must not be
     * able to plant a lasting credential); a sent `password` is ignored.
     */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'locale' => ['sometimes', 'in:de,en,ar'],
        ]);

        $driver = $request->user();
        $driver->fill($data);
        $driver->save();

        return response()->json(['data' => $this->profile($driver)]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'ok']);
    }

    /** A suspended company (disabled / banned / expired) blocks the driver app. */
    private function guardSuspended(Driver $driver): void
    {
        $this->guardSuspendedTenant($driver->loadMissing('tenant')->tenant);
    }

    /** Abort with the app's "account suspended" contract when the tenant is blocked. */
    private function guardSuspendedTenant(?Tenant $tenant): void
    {
        $reason = $tenant?->stateReason();
        if ($reason !== null) {
            abort(response()->json([
                'message' => 'account_suspended',
                'reason' => $reason,
                'support_email' => Settings::get('support_email'),
                'support_whatsapp' => Settings::get('support_whatsapp'),
            ], 403));
        }
    }

    /**
     * A dashboard manager/owner signing into the driver app: must belong to a
     * tenant and hold an app-relevant role. Returns null on any mismatch.
     */
    private function findOwner(string $email, string $password): ?User
    {
        $user = User::where('email', $email)->first();
        // The hash check always runs (against a dummy for an unknown email), so the
        // response time doesn't reveal whether the account exists.
        if (! PasswordCheck::matches($user?->password, $password)
            || $user->tenant_id === null
            || ! $user->hasAnyRole(EnsureFleetOwner::ROLES)) {
            return null;
        }

        return $user;
    }

    /** A dashboard owner/manager matched by email alone (passwordless sign-in). */
    private function findOwnerByEmail(string $email): ?User
    {
        $user = User::where('email', $email)->first();
        if ($user === null
            || $user->tenant_id === null
            || ! $user->hasAnyRole(EnsureFleetOwner::ROLES)) {
            return null;
        }

        return $user;
    }

    private function tokenResponse(Driver $driver): JsonResponse
    {
        $token = $driver->createToken('driver-app')->plainTextToken;

        return response()->json([
            'data' => ['token' => $token, 'is_owner' => false, 'driver' => $this->profile($driver)],
        ]);
    }

    /**
     * Fleet-owner mode runs on strictly weaker credentials than the dashboard — an
     * emailed 6-digit code, no password — so its token is minted read-only and
     * EnsureDashboardToken confines it to `api/v1/driver/fleet/*`. It must never
     * carry '*' and reach the manager API (fleet purge, bulk delete, invites).
     */
    private function ownerTokenResponse(User $owner): JsonResponse
    {
        $token = $owner->createToken('driver-app-owner', [self::OWNER_APP_ABILITY])->plainTextToken;

        return response()->json([
            'data' => ['token' => $token, 'is_owner' => true, 'owner' => $this->ownerProfile($owner)],
        ]);
    }

    private function documentsReadable(Driver $driver): bool
    {
        return ($driver->tenant?->isElprofessorConnected() ?? false)
            || ElProfessorSubmission::query()->withoutGlobalScopes()
                ->where('tenant_id', $driver->tenant_id)
                ->where('driver_id', $driver->id)
                ->exists();
    }

    /** @return array<string, mixed> */
    private function profile(Driver $driver): array
    {
        $driver->loadMissing('tenant');

        return [
            'id' => $driver->id,
            'name' => $driver->name,
            'email' => $driver->email,
            'locale' => $driver->locale,
            'company_name' => $driver->tenant?->name,
            'uber_linked' => $driver->uber_driver_uuid !== null,
            'is_owner' => false,
            // Manager mode (driver token + flag) — NOT is_owner, which is the separate
            // read-only User/fleet:read mode.
            'is_manager' => (bool) $driver->is_manager,
            // Owner who also drives: linked, and (server-checked now) still an owner.
            'owner_linked' => $driver->user_id !== null,
            'admin_capable' => $driver->adminCapable(),
            // MAY SEND: needs the live connection and stops when it ends.
            'documents_enabled' => $driver->tenant?->isElprofessorConnected() ?? false,
            // MAY VIEW: the archive stays the driver's own after a disconnect, so
            // this also holds for anyone who has sent something. A driver who
            // never sent anything to a never-connected company sees nothing.
            'documents_readable' => $this->documentsReadable($driver),
            // Read only where documents are enabled; the app hides the whole
            // section otherwise, so this never stands on its own.
            'gallery_import_enabled' => $driver->tenant?->elprofessorGalleryImportEnabled() ?? false,
            // Defaults to TRUE: an absent flag keeps the odometer step.
            'odometer_required' => $driver->tenant?->elprofessorOdometerRequired() ?? true,
            // Whether this company declines offers on the dispatch panel. The app
            // registers the destructive Reject action on the offer notification
            // only when it is true, so a company with the feature off never shows
            // its drivers a button whose only possible answer is "disabled".
            'dispatch_reject_enabled' => $driver->tenant?->dispatchRejectEnabled() ?? false,
        ];
    }

    /** @return array<string, mixed> */
    private function ownerProfile(User $owner): array
    {
        $owner->loadMissing('tenant');

        return [
            'id' => $owner->id,
            'name' => $owner->name,
            'email' => $owner->email,
            'locale' => $owner->locale,
            'company_name' => $owner->tenant?->name,
            // Owners don't link a personal Uber; reflect the company's fleet
            // session instead, so the profile matches the dashboard's status.
            'uber_linked' => $this->tenantUberLinked($owner->tenant_id),
            'is_owner' => true,
            // The manager MAY FILE a receipt for one of their drivers
            // (`POST fleet/submissions`), which needs the same live El-Professor
            // connection a driver's own send does. Viewing is the fleet-wide
            // archive the app already gives owners, so `documents_readable`
            // stays false. Both owner payloads read the tenant the same way.
            'documents_enabled' => $owner->tenant?->isElprofessorConnected() ?? false,
            'documents_readable' => false,
            'gallery_import_enabled' => $owner->tenant?->elprofessorGalleryImportEnabled() ?? false,
            'odometer_required' => $owner->tenant?->elprofessorOdometerRequired() ?? true,
            // Kept on the owner's profile only so both shapes match for the app's
            // single Profile type. An owner watches the fleet read-only and never
            // gets the decline pop-up or the notification action.
            'dispatch_reject_enabled' => false,
        ];
    }

    /** True when the owner's company has an active captured Uber fleet session. */
    private function tenantUberLinked(?int $tenantId): bool
    {
        return $tenantId !== null
            && UberFleetSession::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('status', UberFleetSession::STATUS_ACTIVE)
                ->exists();
    }
}
