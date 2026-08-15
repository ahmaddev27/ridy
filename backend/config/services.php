<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'dispatch' => [
        // Shared secret the Node dispatch daemon uses to authenticate to the
        // internal ingest endpoint. Must be set for that endpoint to accept calls.
        'ingest_secret' => env('DISPATCH_INGEST_SECRET'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'uber' => [
        // Live fleet dispatch stream (RAMEN). The Node daemon connects here with a
        // captured fleet session; see docs/10-implementation-plan.md.
        'dispatch_base_url' => env('UBER_DISPATCH_BASE_URL', 'https://vsdispatch.uber.com'),
        'supplier_base_url' => env('UBER_SUPPLIER_BASE_URL', 'https://supplier.uber.com'),
    ],

    // A fixed OTP/activation code for testing (any environment). Leave empty in a
    // real production deployment so codes are random.
    'otp_test_code' => env('OTP_TEST_CODE'),

    'uber_auth' => [
        // Node uber-auth service that drives the interactive Uber sign-in browser.
        'url' => env('UBER_AUTH_URL', 'http://localhost:8791'),
        'secret' => env('UBER_AUTH_SECRET'),
        'timeout' => (int) env('UBER_AUTH_TIMEOUT', 60),
    ],

    'fcm' => [
        // Path to the Google service-account JSON. When unset (or the file is
        // missing) pushes are logged instead of sent — see AppServiceProvider.
        'credentials' => env('FCM_CREDENTIALS'),
        // Firebase project id. Falls back to the one in the credentials file.
        'project_id' => env('FCM_PROJECT_ID'),
    ],

];
