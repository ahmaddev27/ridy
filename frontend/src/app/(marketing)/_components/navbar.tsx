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
      className="fixed inset-x-0 top-0 z-[55] flex justify-center backdrop-blur-md"
      style={{ background: "rgba(10,10,10,0.8)" }}
    >
      <div className="flex w-full max-w-6xl items-center justify-center gap-2.5 px-5 py-2.5 text-center text-[12px] font-medium text-white sm:text-sm">
        <span role="img" aria-label="watermelon" className="text-base leading-none">
          🍉
        </span>
        <span>Wir unterstützen Gaza — #FreePalestine</span>
      </div>
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
        <header
          className="glass w-full max-w-5xl rounded-2xl transition-all duration-300"
          style={{
            boxShadow: scrolled
              ? "0 8px 30px -12px rgba(10,12,18,0.18)"
              : "0 2px 12px -6px rgba(10,12,18,0.12)",
          }}
        >
          <div className="flex h-14 items-center justify-between pl-3 pr-3 sm:pr-4">
            <Link href="/#top" className="flex items-center gap-2.5 text-white">
              {/* White monogram in a dark rounded tile — matches the reference's
                  inverted (white-on-dark) 40px logo (w-10 h-10 rounded-xl). */}
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "#0f1116", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <Logo size={28} className="text-white" />
              </span>
              <span className="font-heading text-[15px] font-bold tracking-tight">
                REIDEY
              </span>
            </Link>

            <nav className="hidden items-center gap-7 md:flex">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-white"
                >
                  {l.label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              <a
                href="#kontakt"
                className="hidden items-center text-sm text-muted-foreground transition-colors hover:text-white md:inline-flex"
              >
                Anmelden
              </a>
              <a
                href="#kontakt"
                className="bg-gradient-accent hidden items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:inline-flex"
              >
                Kostenlos testen
              </a>
              <button
                type="button"
                aria-label="Menü"
                onClick={() => setOpen(true)}
                className="p-2 text-white md:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>
      </div>

      <div
        className={`fixed inset-0 z-[60] transition-all duration-300 md:hidden ${
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      >
        {/* Solid dark backdrop — the animated opacity on the parent breaks
            backdrop-filter, so an opaque fill guarantees the page never bleeds
            through the menu (matches the reference's solid overlay). */}
        <div className="absolute inset-0" style={{ background: "#0a0a0a" }} />
        <div className="relative flex h-full flex-col px-5 pt-5">
          <div className="flex h-11 items-center justify-between">
            <span className="font-heading font-bold text-white">REIDEY</span>
            <button
              type="button"
              aria-label="Schließen"
              onClick={() => setOpen(false)}
              className="text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex flex-1 flex-col justify-center gap-1">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="font-heading py-3 text-3xl font-semibold text-white"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <a
            href="#kontakt"
            onClick={() => setOpen(false)}
            className="bg-gradient-accent mb-8 inline-flex items-center justify-center rounded-xl px-6 py-3.5 font-semibold text-white"
          >
            Kostenlos testen
          </a>
        </div>
      </div>
    </>
  );
}
