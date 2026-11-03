import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/context";
import { ThemeProvider } from "@/lib/theme/context";
import { ThemedToaster } from "@/components/ui/themed-toaster";
import { InitialLoader } from "@/components/brand/initial-loader";
import { SentryInit } from "@/components/sentry-init";

// Runs before paint to set the `.dark` class from the saved/system preference,
// avoiding a light→dark flash on load. Kept tiny and dependency-free.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

// Glass-redesign rollout flag (epic #276). DEFAULT OFF: nothing changes unless
// someone opts in with ?glass=1 (persisted in localStorage) or opts out with
// ?glass=0. Sets html[data-glass="on"] before paint, which the new tokens,
// fonts and ambient background in globals.css are scoped to.
const glassScript = `(function(){try{var m=/[?&]glass=([01])/.exec(location.search);if(m){if(m[1]==='1')localStorage.setItem('glass','on');else localStorage.removeItem('glass');}if(localStorage.getItem('glass')==='on'){document.documentElement.setAttribute('data-glass','on');}}catch(e){}})();`;

// Uber-Move-like grotesque for all Latin text + digits (Uber Move itself is licensed).
// adjustFontFallback:false stops next/font from injecting a system fallback into the
// CSS variable — that fallback (no unicode-range) otherwise swallows Arabic glyphs
// before they can fall through to Tajawal, breaking Arabic text.
// Fonts are vendored in ./fonts so the build never needs the network.
const manrope = localFont({
  src: [{ path: "./fonts/manrope-latin-var.woff2", weight: "200 800", style: "normal" }],
  variable: "--font-manrope",
  display: "swap",
  adjustFontFallback: false,
});
// Glass-redesign fonts (only applied under html[data-glass="on"]; the @font-face
// rules are lazy, so nothing is downloaded while the flag is off). Geist for
// Latin + digits, Geist Mono for code/ids, IBM Plex Sans Arabic (Arabic subset
// only, so Latin digits in ar still come from Geist). Vendored like the rest.
const geist = localFont({
  src: [{ path: "./fonts/geist-latin-var.woff2", weight: "400 700", style: "normal" }],
  variable: "--font-geist",
  display: "swap",
  adjustFontFallback: false,
});
const geistMono = localFont({
  src: [{ path: "./fonts/geist-mono-latin-var.woff2", weight: "400 600", style: "normal" }],
  variable: "--font-geist-mono",
  display: "swap",
  adjustFontFallback: false,
});
const plexArabic = localFont({
  src: [
    { path: "./fonts/plex-arabic-arabic-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/plex-arabic-arabic-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/plex-arabic-arabic-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/plex-arabic-arabic-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-ar",
  display: "swap",
  adjustFontFallback: false,
});

// Arabic UI font — applied via CSS when the document is in Arabic/RTL.
const tajawal = localFont({
  src: [
    { path: "./fonts/tajawal-arabic-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/tajawal-arabic-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/tajawal-arabic-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-tajawal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Reidey · Flottenmanagement",
  description:
    "Reidey ist die Flottenmanagement-Plattform für moderne Fahrdienst-Flotten: Fahrerverwaltung, Echtzeit-Benachrichtigungen, Live-Karte, Abrechnung und mehr.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" translate="no" className={`${manrope.variable} ${tajawal.variable} ${geist.variable} ${geistMono.variable} ${plexArabic.variable} h-full`}>
      <head>
        {/* The UI is already multilingual (user picks the language). Browser
            auto-translation rewrites text nodes out from under React, which
            triggers a "removeChild" NotFoundError crash during reconciliation. */}
        <meta name="google" content="notranslate" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: glassScript }} />
      </head>
      <body className="min-h-full bg-canvas text-ink antialiased">
        <ThemeProvider>
          <I18nProvider>{children}</I18nProvider>
          <ThemedToaster />
        </ThemeProvider>
        <InitialLoader />
        <SentryInit />
      </body>
    </html>
  );
}
