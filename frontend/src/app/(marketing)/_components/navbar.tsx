"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";

const LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#funktionen", label: "Funktionen" },
  { href: "#ablauf", label: "Ablauf" },
  { href: "#app", label: "App" },
  { href: "#faq", label: "FAQ" },
];

export function GazaBanner() {
  return (
    <div
      className="fixed inset-x-0 top-0 flex h-9 items-center justify-center bg-background/80 px-4 text-center text-xs backdrop-blur"
      style={{ zIndex: 55, background: "rgba(10,10,10,0.8)", color: "#e5e7eb" }}
    >
      <span>🍉 Wir unterstützen Gaza — #FreePalestine</span>
    </div>
  );
}

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <div className="fixed inset-x-0 top-9 z-50 flex justify-center px-4">
        <nav
          className="glass flex h-14 w-full max-w-5xl items-center gap-4 rounded-2xl px-4 transition-shadow"
          style={{
            boxShadow: scrolled ? "0 10px 40px -12px rgba(0,0,0,0.7)" : "none",
          }}
        >
          <Link href="/#top" className="flex items-center gap-2 text-white">
            <Logo size={26} className="text-[#10b981]" />
            <span className="text-base font-semibold tracking-tight">REIDEY</span>
          </Link>

          <div className="mx-auto hidden items-center gap-7 lg:flex">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm text-white/70 transition-colors hover:text-white"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="ml-auto hidden items-center gap-3 lg:flex">
            <a
              href="#kontakt"
              className="text-sm font-medium text-white/70 transition-colors hover:text-white"
            >
              Anmelden
            </a>
            <a
              href="#kontakt"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
              style={{ background: "linear-gradient(100deg,#10b981,#059669)" }}
            >
              Kostenlos testen
            </a>
          </div>

          <button
            type="button"
            aria-label="Menü öffnen"
            onClick={() => setOpen(true)}
            className="ml-auto flex h-10 w-10 items-center justify-center rounded-xl text-white lg:hidden"
          >
            <Menu size={22} />
          </button>
        </nav>
      </div>

      {open && (
        <div className="glass-strong fixed inset-0 z-[60] flex flex-col items-center justify-center gap-8 lg:hidden">
          <button
            type="button"
            aria-label="Menü schließen"
            onClick={() => setOpen(false)}
            className="absolute right-5 top-6 flex h-11 w-11 items-center justify-center rounded-xl text-white"
          >
            <X size={26} />
          </button>
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="text-3xl font-semibold text-white"
            >
              {l.label}
            </a>
          ))}
          <a
            href="#kontakt"
            onClick={() => setOpen(false)}
            className="mt-4 rounded-2xl px-8 py-4 text-lg font-semibold text-white"
            style={{ background: "linear-gradient(100deg,#10b981,#059669)" }}
          >
            Kostenlos testen
          </a>
        </div>
      )}
    </>
  );
}
