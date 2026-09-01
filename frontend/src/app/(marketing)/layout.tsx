import type { ReactNode } from "react";
import { Manrope, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { GazaBanner, Navbar } from "./_components/navbar";
import { SiteFooter } from "./_components/site-footer";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", adjustFontFallback: false });
const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-heading",
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-mkt",
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
