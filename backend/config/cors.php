<?php

return [
    /*
     * Paths the SPA hits cross-origin. Credentials (cookies) require explicit
     * origins (no wildcard) and supports_credentials => true.
     */
    'paths' => ['api/*', 'sanctum/csrf-cookie', 'login', 'logout'],

    'allowed_methods' => ['*'],

    'allowed_origins' => [
        env('FRONTEND_URL', 'http://localhost:3000'),
    ],

    /*
     * The Ridy browser extension posts the captured Uber session from its own
     * chrome-extension:// (or moz-extension://) origin using a Bearer token, so
     * these origins must be allowed too. The matched origin is echoed back, which
     * keeps supports_credentials valid.
     */
    'allowed_origins_patterns' => [
        '#^chrome-extension://#',
        '#^moz-extension://#',
    ],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => true,
];
