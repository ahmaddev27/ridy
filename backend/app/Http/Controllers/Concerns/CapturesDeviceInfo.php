<?php

namespace App\Http\Controllers\Concerns;

/**
 * Shared handling for the optional device model / OS version an app instance
 * reports on push registration (gathered client-side via expo-device).
 */
trait CapturesDeviceInfo
{
    /**
     * Device attributes to persist, taken only from what the client actually
     * sent. Absent keys are omitted so a re-registration from an older app build
     * (which sends neither) never wipes a value captured by a newer one.
     *
     * @param  array<string, mixed>  $data  Validated request data.
     * @return array<string, mixed>
     */
    protected function deviceInfo(array $data): array
    {
        return array_intersect_key($data, array_flip(['device_name', 'os_version']));
    }
}
