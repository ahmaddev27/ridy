<?php

/**
 * Passkeys (WebAuthn) for the dashboard — docs/22-passkey-groundwork.md.
 *
 * The engine (web-auth/webauthn-lib) only runs the ceremonies; everything
 * about WHERE they are valid lives here. Nothing in this file is a secret: the
 * relying-party id and the origins are public facts about the site, and a
 * passkey's public key is stored as the public material it is.
 */
return [
    /**
     * The relying-party id: the registrable domain a passkey is bound to. The
     * authenticator scopes every credential to it, so it must be the bare host
     * (no scheme, no port) — `reidey.de` in production — and it must never
     * change once passkeys exist, or every one of them stops matching.
     */
    'rp_id' => env('WEBAUTHN_RP_ID') ?: (parse_url((string) env('APP_URL', 'http://localhost'), PHP_URL_HOST) ?: 'localhost'),

    /** The name the authenticator shows next to the site in its credential picker. */
    'rp_name' => env('WEBAUTHN_RP_NAME', 'Reidey'),

    /**
     * The origins a ceremony may come from. APP_URL's origin is ALWAYS in the
     * list — it is the dashboard in production (same-origin) and what the iOS
     * driver app asserts (the plain https://reidey.de) — and WEBAUTHN_ORIGINS
     * ADDS to it, comma-separated, never replaces it (docs/22 §4.3):
     *
     *   - in dev the dashboard runs on its own port, so list it:
     *     WEBAUTHN_ORIGINS=http://localhost:3000
     *   - the driver app on Android asserts one `android:apk-key-hash:<base64url
     *     SHA-256 of the signing cert>` per signing certificate (Play app-signing
     *     key, EAS keystore, debug key), matched verbatim by the engine
     *     (≥ 5.3.3). The real hashes arrive with Phase 0 (§8); none are committed.
     */
    'origins' => array_values(array_unique(array_filter(array_map(
        'trim',
        [
            ...explode(',', (string) env('WEBAUTHN_ORIGINS', '')),
            (string) env('APP_URL', 'http://localhost'),
        ],
    )))),

    /**
     * How long a started ceremony waits for the browser's answer, in seconds.
     * Delete-on-read, so this is also the longest a captured answer could be
     * replayed — it cannot: the options are gone the moment they are read.
     */
    'challenge_ttl' => (int) env('WEBAUTHN_CHALLENGE_TTL', 120),

    /** The hint the browser gets for its own prompt, in milliseconds. Shorter than the TTL on purpose. */
    'timeout_ms' => 60000,
];
