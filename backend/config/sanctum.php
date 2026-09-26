<?php

use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Laravel\Sanctum\Http\Middleware\AuthenticateSession;
use Laravel\Sanctum\Sanctum;

return [

    /*
    |--------------------------------------------------------------------------
    | Stateful Domains
    |--------------------------------------------------------------------------
    |
    | Unchanged from the package default: the dashboard SPA's cookie session.
    | Production deliberately leaves SANCTUM_STATEFUL_DOMAINS unset so this is
    | derived from APP_URL (see docker-compose.prod.yml).
    |
    */

    'stateful' => explode(',', env('SANCTUM_STATEFUL_DOMAINS', sprintf(
        '%s%s',
        'localhost,localhost:3000,127.0.0.1,127.0.0.1:8000,::1',
        Sanctum::currentApplicationUrlWithPort(),
    ))),

    /*
    |--------------------------------------------------------------------------
    | Sanctum Guards
    |--------------------------------------------------------------------------
    |
    | The session guard `auth:sanctum` falls back to (the dashboard). The driver
    | app's `driver` guard does NOT use this fallback — it is bearer-only (see
    | App\Domain\Auth\BearerTokenGuard).
    |
    */

    'guard' => ['web'],

    /*
    |--------------------------------------------------------------------------
    | Absolute Expiration Minutes
    |--------------------------------------------------------------------------
    |
    | Kept null (no absolute lifetime) so a deploy never logs every driver out.
    | Abandoned tokens die through the idle expiry below instead.
    |
    */

    'expiration' => env('SANCTUM_EXPIRATION') !== null ? (int) env('SANCTUM_EXPIRATION') : null,

    /*
    |--------------------------------------------------------------------------
    | Idle (sliding) Expiration
    |--------------------------------------------------------------------------
    |
    | A token unused for this many days is rejected (App\Domain\Auth\
    | TokenLifecycle). An app or extension in regular use keeps refreshing it, so
    | only tokens on abandoned / lost devices expire. 0 disables the check.
    |
    */

    'idle_expiration_days' => (int) env('SANCTUM_IDLE_EXPIRATION_DAYS', 90),

    /*
    |--------------------------------------------------------------------------
    | Last-used tracking
    |--------------------------------------------------------------------------
    |
    | Sanctum's own per-request `last_used_at` UPDATE is off: the driver app polls
    | every few seconds, which made it a hot write. TokenLifecycle refreshes the
    | column at most once per `last_used_at_interval` minutes instead.
    |
    */

    'last_used_at' => false,

    'last_used_at_interval' => (int) env('SANCTUM_LAST_USED_INTERVAL', 10),

    /*
    |--------------------------------------------------------------------------
    | Token Prefix
    |--------------------------------------------------------------------------
    */

    'token_prefix' => env('SANCTUM_TOKEN_PREFIX', ''),

    /*
    |--------------------------------------------------------------------------
    | Sanctum Middleware
    |--------------------------------------------------------------------------
    */

    'middleware' => [
        'authenticate_session' => AuthenticateSession::class,
        'encrypt_cookies' => EncryptCookies::class,
        'validate_csrf_token' => ValidateCsrfToken::class,
    ],

];
