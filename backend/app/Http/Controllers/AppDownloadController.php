<?php

namespace App\Http\Controllers;

use App\Support\Settings;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The public smart install link (reidey.de/get) the invite email points at.
 * Reads the device from the User-Agent and 302-redirects to the matching store
 * — a true pre-page redirect, and (unlike a Next.js route) with no cross-container
 * fetch: it reads the admin-configured URLs straight from settings. A desktop /
 * unknown device, or a store not configured yet, gets a small chooser page.
 */
class AppDownloadController extends Controller
{
    public function redirect(Request $request): RedirectResponse|Response
    {
        $ua = (string) $request->userAgent();
        $android = $this->storeUrl('android');
        $ios = $this->storeUrl('ios');

        if ($this->isAndroid($ua) && $android !== null) {
            return redirect()->away($android);
        }
        if ($this->isIos($ua) && $ios !== null) {
            return redirect()->away($ios);
        }

        return response($this->chooserHtml($android, $ios))
            ->header('Content-Type', 'text/html; charset=utf-8');
    }

    private function storeUrl(string $platform): ?string
    {
        $url = Settings::get('app_'.$platform.'_store_url');

        return filled($url) ? (string) $url : null;
    }

    private function isAndroid(string $ua): bool
    {
        return stripos($ua, 'android') !== false;
    }

    private function isIos(string $ua): bool
    {
        return preg_match('/iphone|ipad|ipod/i', $ua) === 1;
    }

    private function chooserHtml(?string $android, ?string $ios): string
    {
        $button = function (?string $href, string $label): string {
            if ($href === null) {
                return '<span style="display:block;background:#1f2937;color:#9ca3af;padding:14px 20px;border-radius:10px;margin:10px 0">'
                    .e($label).' — bald verfügbar</span>';
            }

            return '<a href="'.e($href).'" style="display:block;background:#059669;color:#fff;text-decoration:none;padding:14px 20px;border-radius:10px;font-weight:600;margin:10px 0">'
                .e($label).'</a>';
        };

        $androidBtn = $button($android, 'Google Play (Android)');
        $iosBtn = $button($ios, 'App Store (iPhone)');

        return <<<HTML
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reidey installieren</title>
</head>
<body style="margin:0;background:#0b0e13;color:#e5e7eb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:380px;margin:0 auto;padding:48px 24px;text-align:center">
<h1 style="font-size:22px;margin:0 0 8px">Reidey installieren</h1>
<p style="color:#9ca3af;margin:0 0 24px">Wähle deinen App-Store:</p>
{$androidBtn}
{$iosBtn}
</div>
</body>
</html>
HTML;
    }
}
