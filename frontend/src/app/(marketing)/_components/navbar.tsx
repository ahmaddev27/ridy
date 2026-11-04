"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, Moon, Sun, X } from "lucide-react";
import { useTheme } from "@/lib/theme/context";

const LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#ablauf", label: "Ablauf" },
  { href: "#funktionen", label: "Funktionen" },
  { href: "#app", label: "App" },
  { href: "#faq", label: "FAQ" },
];

export function GazaBanner() {
  return (
    <div className="border-b border-white/10">
      <div className="mkt-wrap flex items-center justify-center gap-2.5 py-2 text-center text-[12px] font-medium sm:text-[13px]">
        <span role="img" aria-label="watermelon" className="text-base leading-none">
          🍉
        </span>
        <span>Wir unterstützen Gaza — #FreePalestine</span>
      </div>
    </div>
  );
}

function ThemeSwitch() {
  const { theme, toggle } = useTheme();
  const label = theme === "dark" ? "Zum hellen Design wechseln" : "Zum dunklen Design wechseln";
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--m-band-mut)] transition-colors hover:bg-white/10 hover:text-[var(--m-band-ink)]"
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="relative">
      <div className="mkt-wrap flex items-center gap-4 py-[18px] md:gap-9">
        <Link href="/#top" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/reidey-logo.jpeg"
            alt="Reidey"
            className="h-10 w-10 object-contain mix-blend-screen invert"
          />
          <span className="text-[18px] font-semibold tracking-[-0.01em]">Reidey</span>
        </Link>

        <nav className="hidden flex-1 items-center gap-6 md:flex" aria-label="Hauptnavigation">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="mkt-navlink">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-3 md:ms-0">
          <ThemeSwitch />
          <Link href="/login" className="mkt-navlink hidden px-1 py-2.5 font-medium md:inline-block">
            Anmelden
          </Link>
          <Link
            href="/register"
            className="mkt-btn mkt-btn--band hidden !rounded-xl !px-[18px] !py-[11px] !text-[14px] sm:inline-flex"
          >
            Kostenlos testen
          </Link>
          <button
            type="button"
            aria-label={open ? "Menü schließen" : "Menü öffnen"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 md:hidden"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {open ? (
        <nav
          className="mkt-wrap flex flex-col gap-1 border-t border-white/10 pb-5 pt-3 md:hidden"
          aria-label="Mobile Navigation"
        >
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-lg py-3 text-[17px] font-medium text-[var(--m-band-ink)]"
            >
              {l.label}
            </a>
          ))}
          <Link href="/login" onClick={() => setOpen(false)} className="py-3 text-[17px] font-medium">
            Anmelden
          </Link>
          <Link href="/register" onClick={() => setOpen(false)} className="mkt-btn mkt-btn--band mt-2">
            Kostenlos testen
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
