<?php

/**
 * The link to El-Professor, a separate payroll product on the same host.
 *
 * Everything here is OPTIONAL and the feature degrades rather than breaking:
 * with no `intake_url` and no `anon_key` this side simply does not ring, and
 * El-Professor's operator fetches what is waiting with the button on their own
 * review screen. The ring makes a submission arrive immediately; its absence
 * delays it, it does not lose it.
 *
 * That is deliberate, and it is why this side needs no outbound credential of
 * its own: the ring carries no secret at all. El-Professor fetches with the
 * token this side issued, which it holds sealed — the direction the owner chose
 * on 08.10.2026, after it was measured that Sanctum stores only a hash and this
 * side therefore cannot replay the token it minted.
 */
return [
    /**
     * Where a ring goes. El-Professor's `partner-intake` function, reachable
     * on the shared Docker network by container name — no public internet, and
     * nothing here is a destination read out of a request.
     *
     * Example: http://ya-mobility-kong-1:8000/functions/v1/partner-intake
     */
    'intake_url' => env('ELPROFESSOR_INTAKE_URL'),

    /**
     * El-Professor's anon key, which its gateway requires as a bearer on every
     * function call. It is not a credential for the ring — that key ships in
     * their browser bundle and authorises nothing by itself; their function
     * authorises a ring by rate-limiting it and by storing nothing it says.
     */
    'anon_key' => env('ELPROFESSOR_ANON_KEY'),

    /**
     * The disk a driver's receipt photo is written to. `local` keeps it off the
     * public disk, which is served by the web server: a Beleg photo is a
     * business record of one fleet and must not be fetchable by URL.
     */
    'disk' => env('ELPROFESSOR_DISK', 'local'),

    /**
     * The largest photo a driver may submit, in kilobytes. The chain caps a
     * phone photo at 8 MB on their side too; above PHP's `post_max_size` the
     * request arrives EMPTY with no message, which is why the validator's own
     * limit sits below it rather than relying on it.
     */
    'max_document_kb' => (int) env('ELPROFESSOR_MAX_DOCUMENT_KB', 8192),
];
