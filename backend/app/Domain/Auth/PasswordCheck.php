<?php

namespace App\Domain\Auth;

use Illuminate\Support\Facades\Hash;

/**
 * Constant-work password check. Skipping bcrypt for an unknown email made the
 * login endpoints answer measurably faster for addresses with no account — a
 * timing oracle for "who uses Reidey". A missing hash is checked against a fixed
 * dummy (same algorithm + cost as real hashes) so both paths cost the same.
 */
class PasswordCheck
{
    /** bcrypt, cost 12 (the production default). Its result is always discarded. */
    private const DUMMY_HASH = '$2y$12$GVbvckkSz2GjMDQ7U7vJUOaHAcMnIGBsdYXyr2kxLLa7P1waiUPES';

    public static function matches(?string $hash, string $plain): bool
    {
        if ($hash === null || $hash === '') {
            Hash::check($plain, self::DUMMY_HASH);

            return false;
        }

        return Hash::check($plain, $hash);
    }
}
