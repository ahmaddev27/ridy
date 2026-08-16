"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

type NavLink = { href: string; label: string };

/**
 * Mobile navigation drawer. The desktop nav is rendered separately in the
 * layout; this component owns only the small-screen hamburger + stacked menu.
 */
export function MobileNav({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Menü schließen" : "Menü öffnen"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        {open ? <X size={20} strokeWidth={1.75} /> : <Menu size={20} strokeWidth={1.75} />}
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full border-b border-line bg-surface shadow-sm">
          <nav className="mx-auto flex max-w-[1200px] flex-col gap-1 px-4 py-3">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="mt-1 rounded-full bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-ink transition-opacity hover:opacity-90"
            >
              Anmelden
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}
