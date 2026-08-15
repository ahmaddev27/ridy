"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { useI18n } from "@/lib/i18n/context";

/**
 * Public landing for the emailed driver invitation. The mobile app can't reliably
 * intercept an https link without verified App Links, so this page bridges to the
 * app via the `reidey://` deep link (and auto-opens it on mobile).
 */
const COPY: Record<string, { title: string; sub: string; open: string; noToken: string; hint: string }> = {
  de: {
    title: "Willkommen bei Reidey",
    sub: "Öffne die App, um dein Konto zu aktivieren und Fahrtangebote zu empfangen.",
    open: "In der App öffnen",
    noToken: "Ungültiger Einladungslink.",
    hint: "Installiere zuerst die Reidey-Driver-App, dann tippe erneut auf diesen Button.",
  },
  en: {
    title: "Welcome to Reidey",
    sub: "Open the app to activate your account and start receiving ride offers.",
    open: "Open in the app",
    noToken: "Invalid invitation link.",
    hint: "Install the Reidey Driver app first, then tap this button again.",
  },
  ar: {
    title: "أهلاً بك في Reidey",
    sub: "افتح التطبيق لتفعيل حسابك والبدء باستقبال العروض.",
    open: "افتح في التطبيق",
    noToken: "رابط الدعوة غير صالح.",
    hint: "ثبّت تطبيق Reidey Driver أولاً، ثم اضغط الزر مرة أخرى.",
  },
};

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

  const deepLink = token ? `reidey://activate?token=${encodeURIComponent(token)}` : null;

  // Auto-open the app once on load (mobile). If nothing handles it, the button stays.
  useEffect(() => {
    if (deepLink) {
      window.location.href = deepLink;
      setTried(true);
    }
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
            {tried && <p className="mt-4 text-xs text-ink-subtle">{t.hint}</p>}
          </>
        ) : (
          <p className="mt-4 text-sm text-danger-fg">{t.noToken}</p>
        )}
      </div>
    </main>
  );
}
