"use client";

import { Languages } from "lucide-react";
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

  return (
    <div className="relative min-h-screen bg-surface lg:grid lg:grid-cols-[1.02fr_0.98fr]">
      {/* Brand panel — hidden below lg */}
      <aside className="relative hidden overflow-hidden bg-primary text-primary-ink lg:block">
        {/* depth: gradient sheen, soft glows, faint mesh, oversized watermark logo */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_85%_15%,rgba(255,255,255,.18),transparent_55%)]" />
        <div aria-hidden className="pointer-events-none absolute -top-24 end-[-6rem] h-96 w-96 rounded-full bg-white/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute bottom-[-8rem] start-[-4rem] h-96 w-96 rounded-full bg-black/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.10] [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(circle_at_75%_20%,#000,transparent_70%)]" />
        <Logo className="pointer-events-none absolute -bottom-16 -start-16 h-[26rem] w-[26rem] text-white/[0.06]" />

        <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
          {/* brand — top */}
          <div className="flex items-center gap-3">
            <Logo size={40} className="text-primary-ink" />
            <span className="text-2xl font-extrabold tracking-tight">Reidey</span>
          </div>

          {/* headline + testimonial — lower */}
          <div className="max-w-lg">
            <h1 className="mb-4 text-3xl font-extrabold leading-[1.15] tracking-tight xl:text-[2.6rem]">
              {panelTitle}
            </h1>
            <p className="mb-10 text-base leading-relaxed text-primary-ink/85">{panelSubtitle}</p>

            <figure className="flex items-center gap-3.5 border-t border-white/15 pt-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg font-bold ring-1 ring-white/25">
                SK
              </div>
              <figcaption className="leading-tight">
                <div className="font-semibold">Sara Klein</div>
                <div className="text-sm text-primary-ink/75">{t("authPanel.testimonialRole")}</div>
              </figcaption>
            </figure>
          </div>
        </div>
      </aside>

      {/* Form side — carries the controls + curved seam + floating badge */}
      <main className="relative flex min-h-screen flex-col bg-surface px-6 py-7 sm:px-10 lg:-ms-10 lg:rounded-s-[2.75rem] lg:ps-16 lg:shadow-[-24px_0_60px_-30px_rgba(0,0,0,.25)]">
        {/* floating logo badge at the seam (desktop) */}
        <div className="absolute -start-7 top-1/2 hidden -translate-y-1/2 lg:block">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-primary shadow-lg">
            <Logo size={30} className="text-primary" />
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
