import type { ReactNode } from "react";
import localFont from "next/font/local";
import { GazaBanner, Navbar } from "./_components/navbar";
import { SiteFooter } from "./_components/site-footer";

const manrope = localFont({
  src: [{ path: "../fonts/manrope-latin-var.woff2", weight: "200 800", style: "normal" }],
  variable: "--font-manrope",
  display: "swap",
  adjustFontFallback: false,
});
// Inter Tight / JetBrains Mono are variable fonts: one file covers every weight.
const interTight = localFont({
  src: [{ path: "../fonts/inter-tight-latin-var.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-heading",
  display: "swap",
});
const jetBrainsMono = localFont({
  src: [{ path: "../fonts/jetbrains-mono-latin-var.woff2", weight: "100 800", style: "normal" }],
  variable: "--font-mono-mkt",
  display: "swap",
});

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    // The public site is always German + LTR + dark, independent of whatever
    // language/theme a signed-in manager picked for the dashboard.
    <div
      lang="de"
      dir="ltr"
      className={`mkt-root dark ${manrope.variable} ${interTight.variable} ${jetBrainsMono.variable}`}
    >
      <GazaBanner />
      <Navbar />
      <main className="mkt-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
