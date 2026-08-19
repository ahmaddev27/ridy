<?php

use App\Http\Middleware\EnsureDriverTenantActive;
use App\Http\Middleware\EnsureFleetConnected;
use App\Http\Middleware\EnsureSuperAdmin;
use App\Http\Middleware\EnsureUserAccount;
use App\Http\Middleware\VerifyDispatchSecret;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Enable Sanctum SPA (cookie) auth for the API group.
        $middleware->statefulApi();

        $middleware->alias([
            'dispatch.secret' => VerifyDispatchSecret::class,
            'super.admin' => EnsureSuperAdmin::class,
            'driver.active' => EnsureDriverTenantActive::class,
            'user.account' => EnsureUserAccount::class,
            'fleet.connected' => EnsureFleetConnected::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );
        // Report exceptions to Sentry (no-op unless SENTRY_LARAVEL_DSN is set).
        \Sentry\Laravel\Integration::handles($exceptions);
    })->create();
