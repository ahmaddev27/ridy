import type { Metadata } from "next";
import { Inter, Tajawal } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n/context";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Arabic UI font — applied via CSS when the document is in Arabic/RTL.
const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  variable: "--font-tajawal",
});

export const metadata: Metadata = {
  title: "Reidey — Fleet Management",
  description: "Capture live Uber fleet dispatch offers and route them to your drivers.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${tajawal.variable} h-full`}>
      <body className="min-h-full bg-slate-50 text-slate-900 antialiased">
        <I18nProvider>{children}</I18nProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
