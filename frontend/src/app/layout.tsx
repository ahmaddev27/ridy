import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n/context";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "DASHCAM — Fleet Compliance",
  description:
    "Detect personal / off-platform trips for Uber & Bolt fleets via Samsara telematics.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full bg-slate-50 text-slate-900 antialiased">
        <I18nProvider>{children}</I18nProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
