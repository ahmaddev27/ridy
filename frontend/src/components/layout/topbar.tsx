"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellPlus, ChevronDown, LogOut, Volume2, VolumeX, Menu, X, Sun, Moon, HelpCircle } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useI18n } from "@/lib/i18n/context";
import { enableWebPush, listenForeground } from "@/lib/push/web-push";
import { useTheme } from "@/lib/theme/context";
import { ONBOARDING_EVENT } from "@/components/onboarding/onboarding-tour";
import { useAsync } from "@/hooks/use-async";
import { listNotifications } from "@/lib/api/notifications";
import { NotificationsBell } from "./notifications-bell";
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
  const { theme, toggle: toggleTheme } = useTheme();
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

  // Web push: once authenticated, silently re-register the token if the user
  // already granted permission, and listen for foreground messages. The button
  // stays visible until permission is actually granted.
  const [pushGranted, setPushGranted] = useState(true);
  useEffect(() => {
    if (!user) return;
    if (typeof Notification === "undefined") return;

    setPushGranted(Notification.permission === "granted");

    let unsubscribe: (() => void) | undefined;
    void enableWebPush(locale, true);
    void listenForeground().then((fn) => {
      unsubscribe = fn;
    });
    return () => unsubscribe?.();
    // Re-run only when the account changes; locale is read at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleEnablePush() {
    const result = await enableWebPush(locale);
    if (result === "enabled") {
      setPushGranted(true);
      toast.success(t("push.enabled"));
    } else {
      toast.error(t(`push.${result}`));
    }
  }

  return (
    <>
      {/* Mobile drawer — rendered OUTSIDE the backdrop-blur header, whose
          `backdrop-filter` would otherwise become the containing block for this
          `fixed` overlay and collapse it to the header's height. */}
      {navOpen && (
        <div className="fixed inset-0 z-[1200] lg:hidden">
          <div className="absolute inset-0 bg-overlay" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 start-0 flex w-64 flex-col bg-surface shadow-xl">
            <div className="relative">
              <SidebarBrand />
              <button
                onClick={() => setNavOpen(false)}
                className="absolute end-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-subtle hover:bg-surface-2"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <header className="sticky top-0 z-[1100] flex h-16 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur sm:px-5">
        {/* Mobile nav toggle */}
        <button
          onClick={() => setNavOpen(true)}
          className="rounded-lg p-2 text-ink-muted hover:bg-surface-2 lg:hidden"
          aria-label="Menu"
        >
          <Menu className="h-5 w-5" />
        </button>

      <div className="ms-auto flex items-center gap-2">
        {/* Locale switch (functional) */}
        <div className="flex items-center rounded-lg border border-line p-0.5 text-xs font-medium">
          {(["en", "de", "ar"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={cn(
                "rounded-md px-2 py-1 uppercase transition-colors",
                locale === l ? "bg-primary text-primary-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Theme (light/dark) toggle */}
        <button
          onClick={toggleTheme}
          className="rounded-lg p-2 text-ink-muted hover:bg-surface-2"
          title={theme === "dark" ? t("common.lightMode") : t("common.darkMode")}
          aria-label={theme === "dark" ? t("common.lightMode") : t("common.darkMode")}
        >
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        {/* Replay the onboarding tour (managers only) */}
        {isManager && (
          <button
            onClick={() => window.dispatchEvent(new Event(ONBOARDING_EVENT))}
            className="rounded-lg p-2 text-ink-muted hover:bg-surface-2"
            title={t("topbar.tour")}
            aria-label={t("topbar.tour")}
          >
            <HelpCircle className="h-5 w-5" />
          </button>
        )}

        {/* Offer-sound mute toggle (managers only) */}
        {isManager && (
          <button
            onClick={toggleMute}
            className="rounded-lg p-2 text-ink-muted hover:bg-surface-2"
            title={muted ? t("common.unmute") : t("common.mute")}
            aria-label={muted ? t("common.unmute") : t("common.mute")}
          >
            {muted ? <VolumeX className="h-5 w-5 text-ink-subtle" /> : <Volume2 className="h-5 w-5" />}
          </button>
        )}

        {/* Enable web push — hidden once permission is granted */}
        {!pushGranted && (
          <button
            onClick={handleEnablePush}
            className="rounded-lg p-2 text-ink-muted hover:bg-surface-2"
            title={t("push.enable")}
            aria-label={t("push.enable")}
          >
            <BellPlus className="h-5 w-5" />
          </button>
        )}

        {/* Notifications — bell with a hover dropdown of the latest 5 */}
        <NotificationsBell items={notifications?.items ?? []} unread={unread} />

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg p-1 pe-2 hover:bg-surface-2"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-ink">
              {initials(user?.name ?? "?")}
            </span>
            <ChevronDown className="h-4 w-4 text-ink-subtle" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute end-0 z-20 mt-2 w-56 rounded-lg border border-line bg-surface py-1 text-start text-sm shadow-lg">
                <div className="border-b border-line px-3 py-2">
                  <div className="font-medium text-ink">{user?.name}</div>
                  <div className="text-xs text-ink-subtle">{user?.tenant?.name}</div>
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    signOut();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-danger-fg hover:bg-danger-bg"
                >
                  <LogOut className="h-4 w-4" /> {t("topbar.signOut")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      </header>
    </>
  );
}
