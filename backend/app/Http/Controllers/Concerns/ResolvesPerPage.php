<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Http\Request;

trait ResolvesPerPage
{
    /**
     * The requested page size clamped to [1, $max]. A missing lower bound let
     * `per_page=-1` reach the query builder, which drops a negative LIMIT and
     * returns the whole table.
     */
    protected function perPage(Request $request, int $default = 25, int $max = 100): int
    {
        return max(1, min($max, $request->integer('per_page', $default)));
    }
}
