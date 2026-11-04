"use client";

import Link from "next/link";
import { Languages, Moon, ShieldCheck, Sun } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { WhatsAppButton } from "@/components/support/whatsapp-button";
import { useI18n } from "@/lib/i18n/context";
import { useTheme } from "@/lib/theme/context";
import type { Locale } from "@/lib/i18n/dictionaries";

const LANG_ORDER: Locale[] = ["ar", "en", "de"];
const LANG_LABEL: Record<Locale, string> = { ar: "العربية", en: "English", de: "Deutsch" };

/**
 * Auth shell for the unauthenticated pages (login / register / forgot-password),
 * as the prototype's `.auth` two-column layout: the form card on the left (theme +
 * language controls up top, optional step indicator, heading, the page's form, the
 * support WhatsApp button) and the emerald `.auth-aside` brand panel on the right.
 * The aside hides below 900px; a compact logo takes its place in the top bar.
 */
export function AuthLayout({
  title,
  subtitle,
  steps,
  panelTitle,
  panelSubtitle,
  children,
}: {
  title: string;
  subtitle: string;
  /** Current step (1-3) of a multi-step flow; omitted for single-step screens. */
  steps?: number;
  panelTitle: string;
  panelSubtitle: string;
  children: React.ReactNode;
}) {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();
  const nextLang = () => setLocale(LANG_ORDER[(LANG_ORDER.indexOf(locale) + 1) % LANG_ORDER.length]);
  const themeLabel = theme === "dark" ? "Zum hellen Design wechseln" : "Zum dunklen Design wechseln";

  const stats = [
    { value: "2,400+", label: t("authPanel.statDrivers") },
    { value: "99.9%", label: t("authPanel.statUptime") },
    { value: "24/7", label: t("authPanel.statSupport") },
  ];

  return (
    <div className="auth">
      <div className="auth-form">
        <div className="auth-top">
          <Link href="/" className="auth-mlogo">
            <span className="brand-mark" style={{ width: 36, height: 36, borderRadius: 11 }}>
              <Logo size={22} tight />
            </span>
            Reidey
          </Link>
          <span className="grow" />
          <div className="row">
            <button type="button" className="icon-btn" onClick={toggle} title={themeLabel} aria-label={themeLabel}>
              {theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={nextLang}>
              <Languages />
              <span>{LANG_LABEL[locale]}</span>
            </button>
          </div>
        </div>

        <main className="inner" id="main" tabIndex={-1}>
          {steps ? (
            <div className="steps" role="img" aria-label={`${steps} / 3`}>
              {[1, 2, 3].map((n) => (
                <i key={n} className={n <= steps ? "on" : ""} />
              ))}
            </div>
          ) : null}
          <div>
            <h1>{title}</h1>
            <p className="sub">{subtitle}</p>
          </div>
          {children}
          <div className="stack-sm">
            <WhatsAppButton />
          </div>
        </main>
      </div>

      <aside className="auth-aside">
        <div className="grid-dots" />
        <div className="a-top">
          <span className="brand-mark">
            <Logo size={24} tight />
          </span>
          Reidey
        </div>
        <h2>{panelTitle}</h2>
        <p>{panelSubtitle}</p>
        <div className="a-glass">
          {stats.map((s) => (
            <div key={s.label}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        <div className="a-trust">
          <ShieldCheck />
          <span>{t("authPanel.security")}</span>
        </div>
      </aside>
    </div>
  );
}
