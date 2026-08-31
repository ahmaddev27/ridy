"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { useI18n } from "@/lib/i18n/context";

/**
 * Public landing for the emailed driver invitation. The mobile app can't reliably
 * intercept an https link without verified App Links, so this page bridges to the
 * app via the `reidey://` deep link. If the app isn't installed (the deep link
 * does nothing), it falls back to the platform's store download link, which the
 * super-admin configures in Settings and is served by the app-version endpoint.
 */
const COPY: Record<
  string,
  { title: string; sub: string; open: string; download: string; noToken: string; hint: string }
> = {
  de: {
    title: "Willkommen bei Reidey",
    sub: "Öffne die App, um dein Konto zu aktivieren und Fahrtangebote zu empfangen.",
    open: "In der App öffnen",
    download: "App herunterladen",
    noToken: "Ungültiger Einladungslink.",
    hint: "Wenn sich die App nicht öffnet, lade sie zuerst herunter, öffne diesen Link danach erneut.",
  },
  en: {
    title: "Welcome to Reidey",
    sub: "Open the app to activate your account and start receiving ride offers.",
    open: "Open in the app",
    download: "Download the app",
    noToken: "Invalid invitation link.",
    hint: "If the app doesn't open, install it first, then open this link again.",
  },
  ar: {
    title: "أهلاً بك في Reidey",
    sub: "افتح التطبيق لتفعيل حسابك والبدء باستقبال العروض.",
    open: "افتح في التطبيق",
    download: "حمّل التطبيق",
    noToken: "رابط الدعوة غير صالح.",
    hint: "إذا لم يفتح التطبيق، حمّله أولاً ثم افتح هذا الرابط مرة أخرى.",
  },
};

/** iOS vs Android from the UA, so we request the matching store link. */
function detectPlatform(): "ios" | "android" {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /iphone|ipad|ipod/i.test(ua) ? "ios" : "android";
}

export default function DriverActivatePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-canvas" />}>
      <ActivateContent />
    </Suspense>
  );
}

function ActivateContent() {
  const params = useSearchParams();
  const { locale } = useI18n();
  const token = params.get("token");
  const t = COPY[locale] ?? COPY.de;
  const [tried, setTried] = useState(false);
  const [storeUrl, setStoreUrl] = useState<string | null>(null);
  // Read the (async) store URL from the deep-link effect without depending on it,
  // so the handoff fires exactly once instead of again when the URL resolves.
  const storeUrlRef = useRef<string | null>(null);
  storeUrlRef.current = storeUrl;

  const deepLink = token ? `reidey://activate?token=${encodeURIComponent(token)}` : null;

  // Pull the store download link for this device from the app-version endpoint
  // (super-admin sets app_android_store_url / app_ios_store_url in Settings).
  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL ?? "";
    const platform = detectPlatform();
    fetch(`${api}/api/v1/app/version?platform=${platform}&version=0.0.0`, {
      headers: { Accept: "application/json" },
    })
      .then((r) => r.json())
      .then((d) => setStoreUrl(d?.data?.store_url ?? null))
      .catch(() => setStoreUrl(null));
  }, []);

  // Try to hand off to the app on load. If it doesn't take over within a moment
  // (app not installed → the tab stays visible), send them to the store instead.
  useEffect(() => {
    if (!deepLink) return;
    window.location.href = deepLink;
    setTried(true);
    const timer = setTimeout(() => {
      const store = storeUrlRef.current;
      if (store && document.visibilityState === "visible") {
        window.location.href = store;
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [deepLink]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <Logo size={64} className="mx-auto block text-ink" />
        <h1 className="mt-6 text-xl font-bold text-ink">{t.title}</h1>

        {deepLink ? (
          <>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{t.sub}</p>
            <a
              href={deepLink}
              className="mt-6 block rounded-xl bg-primary px-4 py-3 font-semibold text-primary-ink transition-opacity hover:opacity-90"
            >
              {t.open}
            </a>
            {/* Download fallback — always offered so a driver without the app has a
                clear path, and shown as the primary route once the auto-open failed. */}
            {storeUrl && (
              <a
                href={storeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block rounded-xl border border-line px-4 py-3 font-semibold text-ink transition-colors hover:bg-surface-2"
              >
                {t.download}
              </a>
            )}
            {tried && <p className="mt-4 text-xs text-ink-subtle">{t.hint}</p>}
          </>
        ) : (
          <p className="mt-4 text-sm text-danger-fg">{t.noToken}</p>
        )}
      </div>
    </main>
  );
}
