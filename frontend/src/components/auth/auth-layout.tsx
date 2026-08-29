"use client";

import { Languages, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/dictionaries";

const LANG_ORDER: Locale[] = ["ar", "en", "de"];
const LANG_LABEL: Record<Locale, string> = { ar: "العربية", en: "English", de: "Deutsch" };

/**
 * Auth shell for the unauthenticated pages (login / register / forgot-password).
 * A branded emerald panel with a curved inner edge, a floating logo badge at the
 * seam and a short testimonial sits beside the form column; the form column
 * carries the theme + language controls up top and centres its form. The panel
 * hides on small screens (only the form shows). Theme- and RTL-aware via tokens.
 */
export function AuthLayout({
  panelTitle,
  panelSubtitle,
  children,
}: {
  panelTitle: string;
  panelSubtitle: string;
  children: React.ReactNode;
}) {
  const { t, locale, setLocale } = useI18n();
  const nextLang = () => setLocale(LANG_ORDER[(LANG_ORDER.indexOf(locale) + 1) % LANG_ORDER.length]);

  const stats = [
    { value: "2,400+", label: t("authPanel.statDrivers") },
    { value: "99.9%", label: t("authPanel.statUptime") },
    { value: "24/7", label: t("authPanel.statSupport") },
  ];

  return (
    <div className="relative min-h-screen bg-surface lg:grid lg:grid-cols-[1.02fr_0.98fr]">
      {/* Brand panel — full-bleed hero image, hidden below lg */}
      <aside className="relative hidden overflow-hidden bg-primary lg:block">
        <img
          src="/brand/auth-hero.png"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        {/* legibility scrim — darker at the top/bottom where the text sits */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/55" />

        <div className="relative flex h-full flex-col justify-between p-12 text-white xl:p-14">
          <div className="flex items-center gap-3">
            <Logo size={40} className="text-white drop-shadow" />
            <span className="text-2xl font-extrabold tracking-tight drop-shadow">Reidey</span>
          </div>
          <div className="max-w-md space-y-6">
            <div>
              <h1 className="mb-3 text-3xl font-extrabold leading-[1.2] tracking-tight drop-shadow-lg xl:text-[2.5rem]">
                {panelTitle}
              </h1>
              <p className="text-base leading-relaxed text-white/90 drop-shadow">{panelSubtitle}</p>
            </div>

            {/* glass stats card */}
            <div className="grid grid-cols-3 divide-x divide-white/15 rounded-2xl border border-white/15 bg-white/10 shadow-lg backdrop-blur-md [direction:ltr]">
              {stats.map((s) => (
                <div key={s.label} className="px-3 py-4 text-center">
                  <div className="text-2xl font-extrabold tracking-tight">{s.value}</div>
                  <div className="mt-1 text-xs text-white/80">{s.label}</div>
                </div>
              ))}
            </div>

            {/* trust line */}
            <div className="flex items-center gap-2 text-sm text-white/85 drop-shadow">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              {t("authPanel.security")}
            </div>
          </div>
        </div>
      </aside>

      {/* Form side — carries the controls + curved seam + floating badge */}
      <main className="relative flex min-h-screen flex-col bg-surface px-6 py-7 sm:px-10 lg:-ms-10 lg:rounded-s-[2.75rem] lg:ps-16 lg:shadow-[-24px_0_60px_-30px_rgba(0,0,0,.25)]">
        {/* floating logo badge at the seam (desktop) */}
        <div className="absolute -start-10 top-1/2 hidden -translate-y-1/2 lg:block">
          <div className="flex h-[5.5rem] w-[5.5rem] items-center justify-center rounded-full bg-primary shadow-xl ring-4 ring-surface">
            <Logo size={56} className="text-white" />
          </div>
        </div>

        {/* top controls: theme + language (start) · mobile brand (end) */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              type="button"
              onClick={nextLang}
              className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Languages className="h-4 w-4" />
              {LANG_LABEL[locale]}
            </button>
          </div>
          <div className="flex items-center gap-2 lg:hidden">
            <Logo size={26} className="text-ink" />
            <span className="font-bold text-ink">Reidey</span>
          </div>
        </div>

        {/* form — centred in the remaining space */}
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </main>
    </div>
  );
}
