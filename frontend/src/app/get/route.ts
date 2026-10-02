import { NextRequest, NextResponse } from "next/server";

/**
 * Smart app-install link. The invite email can't know the driver's device, so
 * it points its single "install" button here; this route reads the device's
 * User-Agent at tap time and redirects to the matching store. Unknown devices
 * (or an unset store URL) get a small page offering both.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Stores = { android: string | null; ios: string | null };

async function storeUrls(): Promise<Stores> {
  try {
    // Cached briefly so a burst of taps doesn't hit the backend each time; the
    // admin changes these URLs rarely.
    const res = await fetch(`${API_URL}/api/v1/app/stores`, { next: { revalidate: 300 } });
    if (!res.ok) return { android: null, ios: null };
    const body = await res.json();
    return { android: body?.data?.android ?? null, ios: body?.data?.ios ?? null };
  } catch {
    return { android: null, ios: null };
  }
}

export async function GET(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  const { android, ios } = await storeUrls();

  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  const target = isAndroid ? android : isIos ? ios : null;
  if (target) {
    return NextResponse.redirect(target, 302);
  }

  // Desktop, an unrecognised device, or a store URL not configured yet: show both.
  return new NextResponse(chooserPage(android, ios), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function chooserPage(android: string | null, ios: string | null): string {
  const button = (href: string | null, label: string) =>
    href
      ? `<a href="${escapeAttr(href)}" style="display:block;background:#059669;color:#fff;text-decoration:none;padding:14px 20px;border-radius:10px;font-weight:600;margin:10px 0">${label}</a>`
      : `<span style="display:block;background:#1f2937;color:#9ca3af;padding:14px 20px;border-radius:10px;margin:10px 0">${label} — bald verfügbar</span>`;

  return `<!doctype html>
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
${button(android, "Google Play (Android)")}
${button(ios, "App Store (iPhone)")}
</div>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
