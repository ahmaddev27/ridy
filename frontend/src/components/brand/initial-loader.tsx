"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Preloader } from "./preloader";

/** Public marketing routes — always dark/German, and NOT the app, so they must
 *  not show the (theme-following) app splash. */
const MARKETING_ROUTES = ["/", "/faq", "/datenschutz", "/impressum"];

/**
 * Branded splash shown on every full page load (open / refresh). It renders in
 * the initial HTML (so it's visible instantly), then fades out once the window
 * has loaded — with a comfortable minimum so the logo + car animation plays.
 */
export function InitialLoader() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    const start = Date.now();
    const MIN_MS = 1500; // let the draw + car animation play through

    function done() {
      const wait = Math.max(0, MIN_MS - (Date.now() - start));
      setTimeout(() => {
        setHiding(true); // start fade
        setTimeout(() => setVisible(false), 450);
      }, wait);
    }

    if (document.readyState === "complete") done();
    else window.addEventListener("load", done, { once: true });

    const cap = setTimeout(done, 4000); // safety cap if `load` never fires
    return () => clearTimeout(cap);
  }, []);

  // Marketing pages are static + always dark; the app splash would flash light.
  if (MARKETING_ROUTES.includes(pathname) || !visible) return null;

  return (
    <div
      className={`transition-opacity duration-500 ${hiding ? "opacity-0" : "opacity-100"}`}
      aria-hidden={hiding}
    >
      <Preloader />
    </div>
  );
}
