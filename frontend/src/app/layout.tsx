import type { Metadata } from "next";
import { Inter, Tajawal } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/context";
import { ThemeProvider } from "@/lib/theme/context";
import { ThemedToaster } from "@/components/ui/themed-toaster";
import { InitialLoader } from "@/components/brand/initial-loader";
import { SentryInit } from "@/components/sentry-init";

// Runs before paint to set the `.dark` class from the saved/system preference,
// avoiding a light→dark flash on load. Kept tiny and dependency-free.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Arabic UI font — applied via CSS when the document is in Arabic/RTL.
const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  variable: "--font-tajawal",
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
    <html lang="en" className={`${inter.variable} ${tajawal.variable} h-full`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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
