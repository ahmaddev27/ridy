"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Bell, ChevronDown, LogOut } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Topbar() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-slate-200 bg-white/80 px-5 backdrop-blur">
      {/* Search */}
      <div className="relative max-w-md flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          placeholder={t("topbar.search")}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Locale switch (functional) */}
        <div className="flex items-center rounded-lg border border-slate-200 p-0.5 text-xs font-medium">
          {(["en", "de"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={cn(
                "rounded-md px-2 py-1 uppercase transition-colors",
                locale === l ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-700",
              )}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Notifications */}
        <button
          onClick={() => router.push("/notifications")}
          className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500" />
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
              {initials(user?.name ?? "?")}
            </span>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
                <div className="border-b border-slate-100 px-3 py-2">
                  <div className="font-medium text-slate-800">{user?.name}</div>
                  <div className="text-xs text-slate-400">{user?.tenant?.name}</div>
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    signOut();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-rose-600 hover:bg-rose-50"
                >
                  <LogOut className="h-4 w-4" /> {t("topbar.signOut")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
