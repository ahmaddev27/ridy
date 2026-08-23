import type { ReactNode } from "react";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { GazaBanner, Navbar } from "./_components/navbar";
import { SiteFooter } from "./_components/site-footer";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
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
    <div
      className={`mkt-root dark ${inter.variable} ${interTight.variable} ${jetBrainsMono.variable}`}
    >
      <GazaBanner />
      <Navbar />
      <main className="mkt-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
