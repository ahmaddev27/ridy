"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { BellPlus, ChevronDown, ChevronRight, CircleUserRound, LogOut, Volume2, VolumeX, Menu, Sun, Moon, CircleHelp } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useI18n } from "@/lib/i18n/context";
import { enableWebPush, listenForeground } from "@/lib/push/web-push";
import { useTheme } from "@/lib/theme/context";
import { ONBOARDING_EVENT } from "@/components/onboarding/onboarding-tour";
import { NotificationsBell } from "./notifications-bell";
import { useAppFeeds } from "./app-feeds";
import { cn } from "@/lib/utils";
import { navGroups } from "./nav-config";

/** Breadcrumb trail: the nav item that owns the current route. */
function useCrumbs(t: (key: string) => string): string[] {
  const pathname = usePathname();
  const hit = navGroups
    .flatMap((g) => g.items)
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return hit ? [t(hit.label)] : [];
}

/** Deterministic avatar tint (t0-t5), same hash as the prototype. */
function avatarTone(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return "t" + (h % 6);
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, signOut } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle: toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const crumbs = useCrumbs(t);

  // Live unread badge — polled so new notifications surface without a refresh.
  const { notifications, refetchNotifications } = useAppFeeds();
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
    void enableWebPush(locale, true);
    // Re-run only when the account changes; locale is read at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Foreground push toasts — (re)attached once permission is granted, including
  // right after the user enables push from the bell.
  useEffect(() => {
    if (!user || !pushGranted) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void listenForeground(t("common.open")).then((fn) => {
      // The effect may have been torn down before the listener resolved.
      if (cancelled) fn();
      else unsubscribe = fn;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, pushGranted]);

  async function handleEnablePush() {
    const result = await enableWebPush(locale);
    if (result === "enabled") {
      setPushGranted(true);
      toast.success(t("push.enabled"));
    } else {
      toast.error(t(`push.${result}`));
    }
  }

  const firstName = (user?.name ?? "").split(" ")[0];

  return (
    <header className="topbar">
      <button type="button" className="icon-btn menu-toggle" onClick={onMenu} aria-label={t("common.menu")}>
        <Menu />
      </button>

      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span key={c} className="row" style={{ gap: 6 }}>
            {i > 0 && <ChevronRight />}
            {i === crumbs.length - 1 ? <b className="truncate">{c}</b> : <span className="truncate">{c}</span>}
          </span>
        ))}
      </div>

      <div className="top-actions">
        {/* Locale switch (functional) */}
        <div className="seg" role="group" style={{ marginInlineEnd: 6 }}>
          {(["en", "de", "ar"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLocale(l)} className={cn(locale === l && "on")}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Theme (light/dark) toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className="icon-btn"
          title={theme === "dark" ? t("common.lightMode") : t("common.darkMode")}
          aria-label={theme === "dark" ? t("common.lightMode") : t("common.darkMode")}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </button>

        {/* Replay the onboarding tour (managers only) */}
        {isManager && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(ONBOARDING_EVENT))}
            className="icon-btn"
            title={t("topbar.tour")}
            aria-label={t("topbar.tour")}
          >
            <CircleHelp />
          </button>
        )}

        {/* Offer-sound mute toggle (managers only) */}
        {isManager && (
          <button
            type="button"
            onClick={toggleMute}
            className="icon-btn"
            title={muted ? t("common.unmute") : t("common.mute")}
            aria-label={muted ? t("common.unmute") : t("common.mute")}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </button>
        )}

        {/* Enable web push - hidden once permission is granted */}
        {!pushGranted && (
          <button type="button" onClick={handleEnablePush} className="icon-btn" title={t("push.enable")} aria-label={t("push.enable")}>
            <BellPlus />
          </button>
        )}

        {/* Notifications - bell with a dropdown of the latest 5 */}
        <NotificationsBell items={notifications?.items ?? []} unread={unread} onChanged={refetchNotifications} />

        {/* User menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="avatar-btn"
            aria-label={user?.name ?? t("topbar.signOut")}
            aria-expanded={menuOpen}
          >
            <span className={cn("av sm", avatarTone(user?.name ?? "?"))} aria-hidden="true">{initials(user?.name ?? "?")}</span>
            <span className="text-sm strong truncate" style={{ maxWidth: 130 }}>{firstName}</span>
            <ChevronDown style={{ width: 15, height: 15 }} />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="menu end-0 top-full z-20 mt-2">
                <div style={{ padding: "8px 10px 6px" }}>
                  <div className="strong">{user?.name}</div>
                  <div className="subtle text-sm">{user?.tenant?.name}</div>
                </div>
                <hr />
                <Link href="/profile" onClick={() => setMenuOpen(false)}>
                  <CircleUserRound />
                  {t("nav.profile")}
                </Link>
                <hr />
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setMenuOpen(false);
                    signOut();
                  }}
                >
                  <LogOut /> {t("topbar.signOut")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
