import type { ReactNode } from "react";
import { GazaBanner, Navbar } from "./_components/navbar";
import { SiteFooter } from "./_components/site-footer";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    // The public site is German + LTR (no language switcher); it follows the
    // app's light/dark theme. Fonts (Geist / Geist Mono / Tajawal) come from
    // the root layout, exactly like the dashboard.
    <div lang="de" dir="ltr" className="mkt-root">
      <div className="mkt-band">
        <GazaBanner />
        <Navbar />
      </div>
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
