"use client";

import { Logo } from "@/components/brand/logo";
import { useI18n } from "@/lib/i18n/context";

/**
 * Split-screen shell for the unauthenticated auth pages (login / register /
 * forgot-password). A branded emerald panel on the large-screen side carries
 * the logo, a value headline and a few trust stats; the form card lives on the
 * other side. On small screens the panel is hidden and only the form shows,
 * with a compact logo header. Fully theme- and RTL-aware via design tokens.
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
  const { t } = useI18n();

  const stats = [
    { value: "2,400+", label: t("authPanel.statDrivers") },
    { value: "99.9%", label: t("authPanel.statUptime") },
    { value: "24/7", label: t("authPanel.statSupport") },
  ];

  return (
    <div className="grid min-h-screen bg-surface-2 lg:grid-cols-2">
      {/* Brand panel — hidden on small screens */}
      <aside className="relative hidden overflow-hidden bg-primary p-12 text-primary-ink lg:flex lg:flex-col lg:justify-between">
        {/* Decorative soft glows + mesh, kept subtle and non-interactive */}
        <div
          aria-hidden
          className="pointer-events-none absolute -end-24 -top-24 h-80 w-80 rounded-full bg-white/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -start-24 -bottom-24 h-72 w-72 rounded-full bg-black/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(circle_at_30%_20%,#000,transparent_75%)]"
        />

        <div className="relative flex items-center gap-3">
          <Logo size={44} className="text-primary-ink" />
          <span className="text-2xl font-extrabold tracking-tight">Reidey</span>
        </div>

        <div className="relative">
          <h1 className="mb-4 text-3xl font-extrabold leading-tight tracking-tight xl:text-4xl">
            {panelTitle}
          </h1>
          <p className="max-w-md text-base leading-relaxed text-primary-ink/90">
            {panelSubtitle}
          </p>
        </div>

        <dl className="relative flex flex-wrap gap-x-10 gap-y-4">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="text-2xl font-extrabold">{s.value}</dt>
              <dd className="text-sm text-primary-ink/85">{s.label}</dd>
            </div>
          ))}
        </dl>
      </aside>

      {/* Form side */}
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          {/* Compact brand header for small screens (panel is hidden there) */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Logo size={40} className="text-ink" />
            <div className="leading-tight">
              <div className="text-lg font-bold text-ink">Reidey</div>
              <div className="text-xs text-ink-subtle">Fleet Management</div>
            </div>
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}
