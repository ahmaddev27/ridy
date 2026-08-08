<?php

use App\Http\Controllers\Api\V1\AuditLogController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\DashboardController;
use App\Http\Controllers\Api\V1\DeviceTokenController;
use App\Http\Controllers\Api\V1\DispatchDaemonController;
use App\Http\Controllers\Api\V1\DispatchIngestController;
use App\Http\Controllers\Api\V1\DispatchLinkController;
use App\Http\Controllers\Api\V1\DispatchOfferController;
use App\Http\Controllers\Api\V1\DriverController;
use App\Http\Controllers\Api\V1\ExtensionController;
use App\Http\Controllers\Api\V1\FleetSessionController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\NotificationController;
use App\Http\Controllers\Api\V1\UberLoginController;
use App\Http\Middleware\ResolveTenant;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('health', HealthController::class);
    Route::post('login', [AuthController::class, 'login']);

    // Internal — the dispatch daemon. Authenticated by a shared secret
    // (VerifyDispatchSecret), not a user session.
    Route::middleware('dispatch.secret')->prefix('internal/dispatch')->group(function () {
        Route::post('ingest', [DispatchIngestController::class, 'ingest']);
        Route::get('sessions', [DispatchDaemonController::class, 'sessions']);
        Route::post('sessions/{session}/cookies', [DispatchDaemonController::class, 'refreshCookies']);
        Route::post('sessions/{session}/needs-relink', [DispatchDaemonController::class, 'needsRelink']);
        Route::post('sessions/{session}/heartbeat', [DispatchDaemonController::class, 'heartbeat']);
        Route::post('sessions/{session}/roster', [DispatchDaemonController::class, 'roster']);
    });

    Route::middleware(['auth:sanctum', ResolveTenant::class])->group(function () {
        Route::get('me', [AuthController::class, 'me']);
        Route::post('logout', [AuthController::class, 'logout']);

        // Dashboard
        Route::get('dashboard/summary', [DashboardController::class, 'summary']);

        // Fleet drivers
        Route::get('drivers', [DriverController::class, 'index']);
        Route::post('drivers/sync', [DriverController::class, 'sync']);

        // Dispatch offers feed
        Route::get('dispatch/offers', [DispatchOfferController::class, 'index']);

        // Interactive Uber sign-in (email/password -> optional MFA code)
        Route::post('uber-login/start', [UberLoginController::class, 'start']);
        Route::post('uber-login/mfa', [UberLoginController::class, 'mfa']);

        // Browser-extension pairing token (minted from the dashboard session)
        Route::post('extension/token', [ExtensionController::class, 'issueToken']);

        // Uber fleet session status + capture (cookie paste OR extension via token)
        Route::get('fleet-session', [FleetSessionController::class, 'show']);
        Route::post('fleet-session', [FleetSessionController::class, 'capture']);

        // Uber driver linking
        Route::get('dispatch/unlinked-drivers', [DispatchLinkController::class, 'unlinkedDrivers']);
        Route::post('drivers/{driver}/link-uber', [DispatchLinkController::class, 'linkManual']);
        Route::post('dispatch/auto-link', [DispatchLinkController::class, 'autoLink']);

        // Driver app registers its push device token
        Route::post('devices', [DeviceTokenController::class, 'store']);

        // Notifications
        Route::get('notifications', [NotificationController::class, 'index']);
        Route::post('notifications/read', [NotificationController::class, 'markRead']);

        // Governance
        Route::get('audit-logs', [AuditLogController::class, 'index']);
    });
});
