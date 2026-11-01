<?php

namespace App\Http\Middleware;

use App\Domain\Dispatch\PasswordlessLoginSettings;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The passwordless Uber login does not exist for a company that has not been opened
 * for it (docs/27): 404, so a closed company cannot even probe the routes. Read per
 * request, so flipping a flag takes effect without a deploy.
 */
class EnsurePasswordlessLoginEnabled
{
    public function __construct(private readonly PasswordlessLoginSettings $settings) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->settings->availableFor($request->user()?->tenant)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return $next($request);
    }
}
