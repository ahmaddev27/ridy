<?php

return [
    /*
     * Paths the SPA hits cross-origin. Credentials (cookies) require explicit
     * origins (no wildcard) and supports_credentials => true.
     */
    'paths' => ['api/*', 'sanctum/csrf-cookie', 'login', 'logout'],

    'allowed_methods' => ['*'],

    'allowed_origins' => array_values(array_filter([
        env('FRONTEND_URL', 'http://localhost:3000'),
        // Pin the published extension origin in production, e.g.
        // EXTENSION_ORIGIN=chrome-extension://abcdefghijklmnop… — an exact origin
        // is preferred over the broad pattern below (which any installed
        // extension would match).
        env('EXTENSION_ORIGIN'),
    ])),

    /*
     * The Ridy browser extension posts the captured Uber session from its own
     * chrome-extension:// (or moz-extension://) origin using a Bearer token. When
     * EXTENSION_ORIGIN is set we rely on the exact origin above; otherwise (dev,
     * or before the id is known) fall back to the anchored scheme patterns.
     */
    'allowed_origins_patterns' => env('EXTENSION_ORIGIN') ? [] : [
        '#^chrome-extension://[a-p]{32}$#',
        '#^moz-extension://[0-9a-f-]{36}$#',
    ],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => true,
];
