<?php

namespace App\Http\Middleware;

use App\Domain\Dispatch\PasswordlessLoginSettings;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Co-browsing Uber's Arkose puzzle (docs/28) does not exist for a company that was not
 * opened for it: 404, like the passwordless login itself. Read per request.
 */
class EnsureCobrowseEnabled
{
    public function __construct(private readonly PasswordlessLoginSettings $settings) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->settings->cobrowseEnabledFor($request->user()?->tenant)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return $next($request);
    }
}
