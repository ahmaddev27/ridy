<?php

use App\Http\Controllers\Api\V1\AdController;
use App\Http\Controllers\Api\V1\Admin\AdController as AdminAdController;
use App\Http\Controllers\Api\V1\Admin\AdminNotificationController;
use App\Http\Controllers\Api\V1\Admin\BillingReportController;
use App\Http\Controllers\Api\V1\Admin\CollectorController;
use App\Http\Controllers\Api\V1\Admin\CollectorPaymentController;
use App\Http\Controllers\Api\V1\Admin\CompanyController;
use App\Http\Controllers\Api\V1\Admin\CompanyDataController;
use App\Http\Controllers\Api\V1\Admin\CompanySessionController;
use App\Http\Controllers\Api\V1\Admin\CompanyUserController;
use App\Http\Controllers\Api\V1\Admin\ContactMessageController;
use App\Http\Controllers\Api\V1\Admin\EmailTemplateController;
use App\Http\Controllers\Api\V1\Admin\ImpersonationController;
use App\Http\Controllers\Api\V1\Admin\InfrastructureHealthController;
use App\Http\Controllers\Api\V1\Admin\LogViewerController;
use App\Http\Controllers\Api\V1\Admin\NetworkLogController;
use App\Http\Controllers\Api\V1\Admin\OrphanDriverController;
use App\Http\Controllers\Api\V1\Admin\OverviewController;
use App\Http\Controllers\Api\V1\Admin\PlanController;
use App\Http\Controllers\Api\V1\Admin\ProxyController;
use App\Http\Controllers\Api\V1\Admin\QueueAdminController;
use App\Http\Controllers\Api\V1\Admin\SettingsController;
use App\Http\Controllers\Api\V1\Admin\ShardController;
use App\Http\Controllers\Api\V1\Admin\SubscriptionController;
use App\Http\Controllers\Api\V1\Admin\SystemHealthController;
use App\Http\Controllers\Api\V1\Admin\SystemMetricsController;
use App\Http\Controllers\Api\V1\Admin\UserDirectoryController;
use App\Http\Controllers\Api\V1\AppVersionController;
use App\Http\Controllers\Api\V1\AuditLogController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\CompanyActivationController;
use App\Http\Controllers\Api\V1\CompanySubscriptionController;
use App\Http\Controllers\Api\V1\ContactController;
use App\Http\Controllers\Api\V1\DashboardController;
use App\Http\Controllers\Api\V1\DeviceTokenController;
use App\Http\Controllers\Api\V1\DispatchDaemonController;
use App\Http\Controllers\Api\V1\DispatchIngestController;
use App\Http\Controllers\Api\V1\DispatchLinkController;
use App\Http\Controllers\Api\V1\DispatchOfferController;
use App\Http\Controllers\Api\V1\Driver\DriverAuthController;
use App\Http\Controllers\Api\V1\Driver\DriverDashboardController;
use App\Http\Controllers\Api\V1\Driver\DriverDeviceController;
use App\Http\Controllers\Api\V1\Driver\DriverOfferController;
use App\Http\Controllers\Api\V1\Driver\DriverPasswordResetController;
use App\Http\Controllers\Api\V1\Driver\FleetController;
use App\Http\Controllers\Api\V1\Driver\FleetDeviceController;
use App\Http\Controllers\Api\V1\DriverController;
use App\Http\Controllers\Api\V1\DriverInviteController;
use App\Http\Controllers\Api\V1\DriverMetricController;
use App\Http\Controllers\Api\V1\DriverPushController;
use App\Http\Controllers\Api\V1\ExtensionController;
use App\Http\Controllers\Api\V1\FleetSessionController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\NotificationController;
use App\Http\Controllers\Api\V1\NotificationPrefsController;
use App\Http\Controllers\Api\V1\PasswordResetController;
use App\Http\Controllers\Api\V1\ProfileController;
use App\Http\Controllers\Api\V1\PublicPlanController;
use App\Http\Controllers\Api\V1\PublicSupportController;
use App\Http\Controllers\Api\V1\RegistrationController;
use App\Http\Controllers\Api\V1\ResellerController;
use App\Http\Controllers\Api\V1\SupplierCaptureController;
use App\Http\Controllers\Api\V1\UberLoginController;
use App\Http\Controllers\Api\V1\VehicleController;
use App\Http\Middleware\LogDriverAuthContext;
use App\Http\Middleware\ResolveTenant;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('health', HealthController::class);

    // Throttle the dashboard credential endpoint (super-admin/manager/reseller)
    // to blunt brute-force — every other auth endpoint is already throttled.
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:5,1');

    // Public force-update gate for the mobile driver app (checked on launch).
    Route::get('app/version', [AppVersionController::class, 'check'])->middleware('throttle:60,1');

    // Public plan catalogue for the marketing site's pricing section.
    Route::get('plans', [PublicPlanController::class, 'index'])->middleware('throttle:60,1');

    // Public contact form on the landing page (throttled against spam/abuse).
    Route::post('contact', [ContactController::class, 'store'])->middleware('throttle:5,1');

    // Public support-contact (WhatsApp) for the auth pages' "contact support" button.
    Route::get('support-contact', [PublicSupportController::class, 'show'])->middleware('throttle:60,1');

    // Public company self-registration (email OTP).
    Route::post('register', [RegistrationController::class, 'start'])->middleware('throttle:6,1');
    Route::post('register/verify', [RegistrationController::class, 'verify'])->middleware('throttle:12,1');
    Route::post('register/resend', [RegistrationController::class, 'resend'])->middleware('throttle:3,1');

    // Public password reset via email OTP.
    Route::post('password/forgot', [PasswordResetController::class, 'start'])->middleware('throttle:6,1');
    Route::post('password/verify', [PasswordResetController::class, 'verify'])->middleware('throttle:12,1');
    Route::post('password/reset', [PasswordResetController::class, 'reset'])->middleware('throttle:12,1');

    // Company owner enters the admin-generated activation code (3 tries -> ban).
    Route::post('company/activate', [CompanyActivationController::class, 'activate'])->middleware('throttle:10,1');

    // Mobile driver app. Public onboarding + Sanctum-guarded session. No tenant
    // middleware: a driver's tenant is derived from the driver, not the request.
    Route::prefix('driver')->middleware(LogDriverAuthContext::class)->group(function () {
        Route::get('invite/{token}', [DriverAuthController::class, 'invite'])->middleware('throttle:20,1');
        Route::post('activate', [DriverAuthController::class, 'activate'])->middleware('throttle:10,1');
        Route::post('login', [DriverAuthController::class, 'login'])->middleware('throttle:10,1');

        // Passwordless sign-in: email a one-time code, then exchange it for a token.
        // Serves both drivers and fleet owners/managers; no password ever set.
        Route::post('login/request', [DriverAuthController::class, 'loginRequest'])->middleware('throttle:6,1');
        Route::post('login/verify', [DriverAuthController::class, 'loginVerify'])->middleware('throttle:12,1');

        // In-app "forgot password" via an email OTP (mirrors the manager flow).
        Route::post('password/forgot', [DriverPasswordResetController::class, 'start'])->middleware('throttle:6,1');
        Route::post('password/verify', [DriverPasswordResetController::class, 'verify'])->middleware('throttle:12,1');
        Route::post('password/reset', [DriverPasswordResetController::class, 'reset'])->middleware('throttle:12,1');

        Route::middleware('auth:driver')->group(function () {
            // Logout must work even when suspended (so the app can clear its token).
            Route::post('logout', [DriverAuthController::class, 'logout']);

            // Everything else requires the driver's company to still be active.
            Route::middleware('driver.active')->group(function () {
                Route::get('me', [DriverAuthController::class, 'me']);
                Route::patch('me', [DriverAuthController::class, 'update']);
                Route::post('devices', [DriverDeviceController::class, 'store']);
                Route::delete('devices', [DriverDeviceController::class, 'destroy']);
                Route::get('home', [DriverDashboardController::class, 'home']);
                Route::get('stats', [DriverDashboardController::class, 'stats']);
                Route::get('offers', [DriverOfferController::class, 'index']);
                Route::post('offers/seen', [DriverOfferController::class, 'markSeen']);
                Route::get('offers/{offer}', [DriverOfferController::class, 'show']);

                // WebSocket (Reverb) channel authorisation for the driver's app —
                // authenticates the private driver.{id} channel via the driver guard.
                Route::post('broadcasting/auth', fn (Request $request) => Broadcast::auth($request));
            });
        });

        // Fleet-owner mode: a dashboard manager/owner signs into the SAME app and
        // monitors ALL their drivers read-only. Their token resolves on the `User`
        // (auth:sanctum, not auth:driver); `driver.active` still blocks a suspended
        // tenant, and FleetController rejects non-tenant callers.
        Route::middleware(['auth:sanctum', 'driver.active'])->prefix('fleet')->group(function () {
            Route::get('me', [FleetController::class, 'me']);
            Route::patch('me', [FleetController::class, 'update']);
            Route::post('logout', [FleetController::class, 'logout']);
            Route::get('home', [FleetController::class, 'home']);
            Route::get('drivers', [FleetController::class, 'drivers']);
            Route::get('offers', [FleetController::class, 'offers']);
            Route::get('offers/{offer}', [FleetController::class, 'showOffer']);
            Route::get('stats', [FleetController::class, 'stats']);
            // The owner's own push device (User token) — receives every driver's offers.
            Route::post('devices', [FleetDeviceController::class, 'store']);
            Route::delete('devices', [FleetDeviceController::class, 'destroy']);
        });
    });

    // Internal — the dispatch daemon. Authenticated by a shared secret
    // (VerifyDispatchSecret), not a user session.
    Route::middleware('dispatch.secret')->prefix('internal/dispatch')->group(function () {
        Route::post('ingest', [DispatchIngestController::class, 'ingest']);
        Route::get('sessions', [DispatchDaemonController::class, 'sessions']);
        Route::post('sessions/{session}/cookies', [DispatchDaemonController::class, 'refreshCookies']);
        Route::post('sessions/{session}/needs-relink', [DispatchDaemonController::class, 'needsRelink']);
        Route::post('sessions/{session}/heartbeat', [DispatchDaemonController::class, 'heartbeat']);
        Route::post('sessions/{session}/roster', [DispatchDaemonController::class, 'roster']);
        Route::post('sessions/{session}/statuses', [DispatchDaemonController::class, 'statuses']);
    });

    // Session basics every authenticated user needs — including tenant-less ones
    // (resellers). NOT tenant-scoped, so they never hit the no-tenant guard.
    Route::middleware(['auth:sanctum', 'user.account'])->group(function () {
        Route::get('me', [AuthController::class, 'me']);
        Route::post('logout', [AuthController::class, 'logout']);
        // Stop impersonating: mid-impersonation the caller is a manager, so this
        // lives outside the super-admin group (the session key gates it).
        Route::post('impersonate/stop', [ImpersonationController::class, 'stop']);
        // Dashboard client-side error reporter → the admin's frontend log. Any signed-in
        // dashboard user, throttled + size-capped in the controller.
        Route::post('client-log', [LogViewerController::class, 'recordFrontend'])->middleware('throttle:30,1');
        // Reverb broadcasting auth for the dashboard — authorises private channels
        // (e.g. company.{tenantId}) for the signed-in user via routes/channels.php.
        Route::post('broadcasting/auth', fn (Request $request) => Broadcast::auth($request));
    });

    Route::middleware(['auth:sanctum', 'user.account', ResolveTenant::class, 'dashboard.only'])->group(function () {
        // Dashboard
        Route::get('dashboard/summary', [DashboardController::class, 'summary']);

        // The current live platform ad for this company's Offers slot.
        Route::get('ads/current', [AdController::class, 'current']);
        Route::get('ads/media/{filename}', [AdController::class, 'media']);

        // The company's own subscription history (codes/plans/collector/status).
        Route::get('subscription/history', [CompanySubscriptionController::class, 'index']);
        // Redeem a subscription code from inside the dashboard (stacks after current).
        Route::post('subscription/redeem', [CompanySubscriptionController::class, 'redeem'])->middleware('throttle:10,1');

        // Fleet drivers
        Route::get('drivers', [DriverController::class, 'index']);
        Route::get('drivers/live', [DriverController::class, 'live']);
        Route::get('drivers/{driver}', [DriverController::class, 'show']);
        Route::patch('drivers/{driver}', [DriverController::class, 'update']);
        Route::get('drivers/{driver}/stats', [DriverController::class, 'stats']);
        // Browser-fed ingest: only for a company that has connected its own Uber
        // account (a stored session), never an arbitrary account the manager is
        // signed into. Guarded by fleet.connected.
        Route::post('drivers/sync', [DriverController::class, 'sync'])->middleware('fleet.connected');
        Route::post('drivers/roster', [DriverController::class, 'ingestRoster'])->middleware('fleet.connected');
        Route::post('drivers/statuses', [DriverController::class, 'ingestStatuses'])->middleware('fleet.connected');

        // Per-driver Uber performance metrics (earnings/hours/trips)
        Route::post('drivers/metrics', [DriverMetricController::class, 'store'])->middleware('fleet.connected');
        Route::get('drivers/{driver}/metrics', [DriverMetricController::class, 'index']);

        // Fleet vehicles (synced from Uber via the extension)
        Route::get('vehicles', [VehicleController::class, 'index']);
        Route::post('vehicles', [VehicleController::class, 'ingest'])->middleware('fleet.connected');

        // Generic supplier capture — the extension pulls any Uber Fleet tab
        // (documents/reports/invoices/banking/promotions/inbox/…) and POSTs the raw
        // payload here tagged with a kind, so it lands in the admin Network feed.
        Route::post('supplier/capture', [SupplierCaptureController::class, 'store'])->middleware('fleet.connected');

        // Dispatch offers feed
        Route::get('dispatch/offers', [DispatchOfferController::class, 'index']);
        Route::get('dispatch/offers/stats', [DispatchOfferController::class, 'stats']);
        Route::get('dispatch/offers/export', [DispatchOfferController::class, 'export']);
        Route::get('dispatch/offers/{offer}', [DispatchOfferController::class, 'show']);
        // Extension forwards RAMEN offers captured in the manager's browser.
        Route::post('dispatch/offers/ingest', [DispatchOfferController::class, 'ingest'])->middleware('fleet.connected');
        Route::post('dispatch/offers/bulk-delete', [DispatchOfferController::class, 'bulkDestroy']);
        Route::delete('dispatch/offers/{offer}', [DispatchOfferController::class, 'destroy']);

        // Interactive Uber sign-in (email/password -> optional MFA code)
        Route::post('uber-login/start', [UberLoginController::class, 'start']);
        Route::post('uber-login/mfa', [UberLoginController::class, 'mfa']);

        // Browser-extension pairing token (minted from the dashboard session)
        Route::post('extension/token', [ExtensionController::class, 'issueToken']);

        // Uber fleet session status + capture (cookie paste OR extension via token)
        Route::get('fleet-session', [FleetSessionController::class, 'show']);
        Route::post('fleet-session', [FleetSessionController::class, 'capture']);
        Route::post('fleet-session/reconnect', [FleetSessionController::class, 'reconnect']);
        Route::post('fleet-session/report-broken', [FleetSessionController::class, 'reportBroken']);
        Route::delete('fleet-session', [FleetSessionController::class, 'destroy']);

        // Uber driver linking
        Route::get('dispatch/unlinked-drivers', [DispatchLinkController::class, 'unlinkedDrivers']);
        Route::post('drivers/{driver}/link-uber', [DispatchLinkController::class, 'linkManual']);
        Route::post('dispatch/auto-link', [DispatchLinkController::class, 'autoLink']);

        // Invite a driver to the mobile app (emailed activation link).
        Route::post('drivers/{driver}/invite', [DriverInviteController::class, 'send']);
        // Send a diagnostic test push to the driver's registered devices.
        Route::post('drivers/{driver}/test-push', [DriverPushController::class, 'test']);

        // Driver app registers its push device token
        Route::post('devices', [DeviceTokenController::class, 'store']);

        // Notifications
        Route::get('notifications', [NotificationController::class, 'index']);
        Route::post('notifications/read', [NotificationController::class, 'markRead']);
        Route::delete('notifications/clear', [NotificationController::class, 'clear']);
        Route::delete('notifications/{id}', [NotificationController::class, 'destroy']);
        // Browser FCM token for dashboard web push.
        Route::post('notifications/device', [NotificationController::class, 'registerDevice']);
        Route::delete('notifications/device', [NotificationController::class, 'unregisterDevice']);

        // Per-category web-push + email notification preferences (bell always on).
        Route::get('notification-prefs', [NotificationPrefsController::class, 'show']);
        Route::put('notification-prefs', [NotificationPrefsController::class, 'update']);

        // Governance
        Route::get('audit-logs', [AuditLogController::class, 'index']);

        // The authenticated user edits their own account (managers + super-admin).
        Route::put('profile', [ProfileController::class, 'update']);
    });

    // Platform owner (super-admin). Deliberately WITHOUT ResolveTenant so the
    // tenant context stays empty and the global scope no-ops → cross-tenant.
    // Reseller (a collector with a login) issues activation codes on a plan.
    // No ResolveTenant — resellers are platform-level, not tenant users.
    // Gate the WHOLE reseller group on the reseller permission — previously only
    // generate()/codes() checked in-controller, leaving plans()/searchCompanies()
    // open to any authenticated user (cross-tenant company + owner-phone leak).
    Route::middleware(['auth:sanctum', 'user.account', 'can:codes.generate'])->prefix('reseller')->group(function () {
        Route::get('plans', [ResellerController::class, 'plans']);
        Route::get('companies/search', [ResellerController::class, 'searchCompanies']);
        Route::post('activation', [ResellerController::class, 'generate']);
        Route::get('codes', [ResellerController::class, 'codes']);
    });

    Route::middleware(['auth:sanctum', 'super.admin'])->prefix('admin')->group(function () {
        Route::get('overview', OverviewController::class);
        Route::get('system-health', SystemHealthController::class);
        Route::get('system-metrics', SystemMetricsController::class);
        Route::get('infrastructure', InfrastructureHealthController::class);
        Route::get('queue/failed', [QueueAdminController::class, 'failed']);
        Route::post('queue/retry', [QueueAdminController::class, 'retry']);
        Route::post('queue/flush', [QueueAdminController::class, 'flush']);
        Route::post('queue/clear-pending', [QueueAdminController::class, 'clearPending']);
        Route::get('logs', [LogViewerController::class, 'index']);
        Route::delete('logs', [LogViewerController::class, 'clear']);
        Route::delete('network-logs', [NetworkLogController::class, 'clear']);
        Route::get('settings', [SettingsController::class, 'show']);
        Route::put('settings', [SettingsController::class, 'update']);
        Route::post('settings/test-email', [SettingsController::class, 'testEmail']);

        // Email templates (registration + driver invite)
        Route::get('email-templates', [EmailTemplateController::class, 'index']);
        Route::post('email-templates/image', [EmailTemplateController::class, 'uploadImage']);
        Route::get('email-templates/{key}', [EmailTemplateController::class, 'show']);
        Route::put('email-templates/{key}', [EmailTemplateController::class, 'update']);
        Route::post('email-templates/{key}/preview', [EmailTemplateController::class, 'preview']);

        // Residential proxy pool
        Route::get('proxies', [ProxyController::class, 'index']);
        Route::post('proxies', [ProxyController::class, 'store']);
        Route::put('proxies/{proxy}', [ProxyController::class, 'update']);
        Route::delete('proxies/{proxy}', [ProxyController::class, 'destroy']);

        // Platform-wide user directory (managers, resellers, admins).
        Route::get('users', [UserDirectoryController::class, 'index']);
        Route::delete('users/{user}', [UserDirectoryController::class, 'destroy']);

        Route::get('orphan-drivers', OrphanDriverController::class);

        // Broadcast a bell + push notification to a set of users (queued).
        Route::post('notifications/broadcast', [AdminNotificationController::class, 'broadcast']);

        // Daemon shards — scale-out visibility + control.
        Route::get('shards', [ShardController::class, 'index']);
        Route::patch('shards/{shard}', [ShardController::class, 'update']);
        Route::post('shards/rebalance', [ShardController::class, 'rebalance']);

        Route::get('companies', [CompanyController::class, 'index']);
        Route::post('companies', [CompanyController::class, 'store']);
        Route::get('companies/{tenant}', [CompanyController::class, 'show']);
        Route::put('companies/{tenant}', [CompanyController::class, 'update']);
        Route::delete('companies/{tenant}', [CompanyController::class, 'destroy']);

        // Read-only drill-down into a company's fleet data (admin tabs).
        Route::get('companies/{tenant}/drivers', [CompanyDataController::class, 'drivers']);
        Route::get('companies/{tenant}/offers', [CompanyDataController::class, 'offers']);
        Route::get('companies/{tenant}/vehicles', [CompanyDataController::class, 'vehicles']);
        Route::get('companies/{tenant}/network', [CompanyDataController::class, 'network']);
        Route::delete('companies/{tenant}/network', [CompanyDataController::class, 'clearNetwork']);

        Route::get('companies/{tenant}/users', [CompanyUserController::class, 'index']);
        Route::post('companies/{tenant}/users', [CompanyUserController::class, 'store']);
        Route::post('companies/{tenant}/users/{user}/reset-password', [CompanyUserController::class, 'resetPassword']);

        // Subscriptions: generate an activation code, review + lift bans.
        Route::get('banned-companies', [SubscriptionController::class, 'banned']);
        Route::post('companies/{tenant}/activation', [SubscriptionController::class, 'generate']);
        Route::post('companies/{tenant}/free-subscription', [SubscriptionController::class, 'grantFree']);
        Route::post('companies/{tenant}/reactivate', [SubscriptionController::class, 'reactivate']);
        Route::delete('companies/{tenant}/subscription', [SubscriptionController::class, 'endSubscription']);

        Route::get('companies/{tenant}/session', [CompanySessionController::class, 'show']);
        Route::post('companies/{tenant}/session/relink', [CompanySessionController::class, 'forceRelink']);
        Route::delete('companies/{tenant}/session', [CompanySessionController::class, 'destroy']);
        // Disconnect + wipe all operational fleet data (drivers/vehicles/offers/
        // devices/metrics/session). Keeps the tenant, users and billing history.
        Route::delete('companies/{tenant}/data', [CompanySessionController::class, 'purge']);

        // Act as a company: swap the dashboard session to one of its managers so
        // the admin can run the manager-only Uber connect flow. Stop lives on the
        // authenticated group above (the caller is a manager mid-impersonation).
        Route::post('companies/{tenant}/impersonate', [ImpersonationController::class, 'start']);

        // Cash collectors + payment ledger.
        Route::get('collectors', [CollectorController::class, 'index']);
        Route::post('collectors', [CollectorController::class, 'store']);
        Route::put('collectors/{collector}', [CollectorController::class, 'update']);
        Route::delete('collectors/{collector}', [CollectorController::class, 'destroy']);

        Route::get('collector-payments', [CollectorPaymentController::class, 'index']);
        Route::get('collector-payments/export', [CollectorPaymentController::class, 'export']);
        Route::post('collector-payments', [CollectorPaymentController::class, 'store']);
        Route::delete('collector-payments/{payment}', [CollectorPaymentController::class, 'destroy']);

        // Subscription plans (resellers sell these).
        Route::get('plans', [PlanController::class, 'index']);
        Route::post('plans', [PlanController::class, 'store']);
        Route::put('plans/{plan}', [PlanController::class, 'update']);
        Route::delete('plans/{plan}', [PlanController::class, 'destroy']);

        // Platform-wide promotional ads shown on every company's Offers view.
        Route::get('ads', [AdminAdController::class, 'index']);
        Route::post('ads', [AdminAdController::class, 'store']);
        Route::post('ads/upload', [AdminAdController::class, 'upload']);
        Route::put('ads/{ad}', [AdminAdController::class, 'update']);
        Route::delete('ads/{ad}', [AdminAdController::class, 'destroy']);

        // Inbox: landing-page contact-form submissions.
        Route::get('contact-messages', [ContactMessageController::class, 'index']);
        Route::patch('contact-messages/{contactMessage}', [ContactMessageController::class, 'update']);
        Route::delete('contact-messages/{contactMessage}', [ContactMessageController::class, 'destroy']);

        // Billing: subscription revenue reports + auto-generated invoices.
        Route::get('reports/billing-summary', [BillingReportController::class, 'summary']);
        Route::get('subscription-invoices', [BillingReportController::class, 'invoices']);
        Route::get('subscription-invoices/export', [BillingReportController::class, 'invoicesExport']);
        Route::post('subscription-invoices/{invoice}/settle', [BillingReportController::class, 'settle']);

        // Issued activation codes ledger (all resellers).
        Route::get('subscription-codes', [BillingReportController::class, 'codes']);
        Route::get('subscription-codes/export', [BillingReportController::class, 'codesExport']);
    });
});
