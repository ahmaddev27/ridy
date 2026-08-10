"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Bell, ChevronDown, LogOut, Volume2, VolumeX, Menu, X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listNotifications } from "@/lib/api/notifications";
import { cn } from "@/lib/utils";
import { SidebarBrand } from "./sidebar";
import { NavList } from "./nav-list";

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
  const [navOpen, setNavOpen] = useState(false);

  // Live unread badge — polled so new notifications surface without a refresh.
  const { data: notifications } = useAsync(listNotifications, { refetchInterval: 15000 });
  const unread = notifications?.unread ?? 0;

  // Offer-alert sound mute (persisted); the OfferAlerts watcher reads the same key.
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    setMuted(localStorage.getItem("offerSoundMuted") === "1");
  }, []);
  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      localStorage.setItem("offerSoundMuted", next ? "1" : "0");
      return next;
    });
  }
  const isManager = Boolean(user?.tenant);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur sm:px-5">
      {/* Mobile nav toggle */}
      <button
        onClick={() => setNavOpen(true)}
        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
        aria-label="Menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 start-0 flex w-64 flex-col bg-white shadow-xl">
            <div className="relative">
              <SidebarBrand />
              <button
                onClick={() => setNavOpen(false)}
                className="absolute end-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative hidden max-w-md flex-1 sm:block">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          placeholder={t("topbar.search")}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 ps-9 pe-3 text-sm outline-none focus:border-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-200"
        />
      </div>

      <div className="ms-auto flex items-center gap-2">
        {/* Locale switch (functional) */}
        <div className="flex items-center rounded-lg border border-slate-200 p-0.5 text-xs font-medium">
          {(["en", "de", "ar"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={cn(
                "rounded-md px-2 py-1 uppercase transition-colors",
                locale === l ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700",
              )}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Offer-sound mute toggle (managers only) */}
        {isManager && (
          <button
            onClick={toggleMute}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            title={muted ? t("common.unmute") : t("common.mute")}
            aria-label={muted ? t("common.unmute") : t("common.mute")}
          >
            {muted ? <VolumeX className="h-5 w-5 text-slate-400" /> : <Volume2 className="h-5 w-5" />}
          </button>
        )}

        {/* Notifications */}
        <button
          onClick={() => router.push("/notifications")}
          className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg p-1 pe-2 hover:bg-slate-100"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-800">
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
              <div className="absolute end-0 z-20 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 text-start text-sm shadow-lg">
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
