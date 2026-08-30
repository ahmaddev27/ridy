<?php

use App\Http\Middleware\EnsureDashboardToken;
use App\Http\Middleware\EnsureDriverTenantActive;
use App\Http\Middleware\EnsureFleetConnected;
use App\Http\Middleware\EnsureSuperAdmin;
use App\Http\Middleware\EnsureUserAccount;
use App\Http\Middleware\ResolveTenant;
use App\Http\Middleware\VerifyDispatchSecret;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Support\Facades\Log;
use Laravel\Sanctum\PersonalAccessToken;
use Sentry\Laravel\Integration;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Enable Sanctum SPA (cookie) auth for the API group.
        $middleware->statefulApi();

        // This is an API-only backend with no `login` route. Never let the auth
        // middleware try to redirect an unauthenticated guest to route('login') —
        // that throws RouteNotFoundException (a 500) instead of a clean 401 JSON.
        // Returning null skips the redirect so AuthenticationException renders as
        // 401 via shouldRenderJsonWhen(api/*).
        $middleware->redirectGuestsTo(fn () => null);

        // The app is only reachable through the Caddy reverse proxy (backend
        // ports are internal-only). Trust it so $request->ip() reflects the real
        // client — otherwise per-IP throttles key on the proxy address and would
        // rate-limit every visitor as one, and access logs record the proxy.
        $middleware->trustProxies(at: '*', headers: Request::HEADER_X_FORWARDED_FOR
            | Request::HEADER_X_FORWARDED_HOST
            | Request::HEADER_X_FORWARDED_PORT
            | Request::HEADER_X_FORWARDED_PROTO);

        $middleware->alias([
            'dispatch.secret' => VerifyDispatchSecret::class,
            'super.admin' => EnsureSuperAdmin::class,
            'driver.active' => EnsureDriverTenantActive::class,
            'user.account' => EnsureUserAccount::class,
            'fleet.connected' => EnsureFleetConnected::class,
            'dashboard.only' => EnsureDashboardToken::class,
        ]);

        // SECURITY: route-model binding must resolve AFTER the tenant context is
        // set, otherwise implicit {driver}/{offer} bindings query unscoped and a
        // manager can bind another tenant's record by id (cross-tenant IDOR).
        // Force ResolveTenant ahead of SubstituteBindings in the priority order.
        $middleware->prependToPriorityList(
            before: SubstituteBindings::class,
            prepend: ResolveTenant::class,
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );

        // TEMPORARY diagnostic: every driver-endpoint 401 flows through here.
        // Log (at error level) exactly WHY the token was rejected so the recurring
        // "session_invalidated" logout can be pinned. Returns null so the normal
        // 401 JSON still renders. Remove once the root cause is confirmed.
        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/v1/driver/*') && ! $request->is('api/v1/driver/fleet/*')) {
                $bearer = $request->bearerToken();
                $pat = $bearer !== null && $bearer !== '' ? PersonalAccessToken::findToken($bearer) : null;

                Log::error('driver_auth_401', [
                    'path' => $request->path(),
                    'token_state' => match (true) {
                        $bearer === null || $bearer === '' => 'no_bearer',
                        $pat === null => 'token_not_found',
                        $pat->tokenable === null => 'orphan_driver_deleted',
                        default => 'resolves_ok_but_guard_rejected',
                    },
                    'tokenable_id' => $pat?->tokenable_id,
                ]);
            }

            return null;
        });
        // Report exceptions to Sentry (no-op unless SENTRY_LARAVEL_DSN is set).
        // Guarded so a missing package (e.g. a stale image) never fatals boot.
        if (class_exists(Integration::class)) {
            Integration::handles($exceptions);
        }
    })->create();
