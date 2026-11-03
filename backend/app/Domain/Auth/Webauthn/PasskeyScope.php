<?php

namespace App\Domain\Auth\Webauthn;

/**
 * Which front door a passkey opens. The two never mix: a credential enrolled
 * in the app signs in to the app only, and a dashboard one to the dashboard only.
 */
enum PasskeyScope: string
{
    case Dashboard = 'dashboard';
    case App = 'app';
}
