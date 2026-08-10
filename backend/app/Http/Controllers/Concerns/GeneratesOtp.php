<?php

namespace App\Http\Controllers\Concerns;

trait GeneratesOtp
{
    /** A zero-padded 6-digit numeric one-time password. */
    protected function newOtp(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }
}
