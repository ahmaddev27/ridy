"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAsync } from "@/hooks/use-async";
import { usePolling } from "@/hooks/use-polling";
import { useAuth } from "@/components/auth/auth-provider";
import { listNotifications, type NotificationList } from "@/lib/api/notifications";
import { listContactMessages } from "@/lib/api/contact-messages";
import { listPaymentClaims } from "@/lib/api/admin";

/** Fire after an action that changes an admin badge (e.g. inbox message read). */
export const ADMIN_BADGES_REFRESH_EVENT = "admin-badges:refresh";

type AppFeeds = {
  notifications: NotificationList | null;
  notificationsLoading: boolean;
  notificationsError: string | null;
  refetchNotifications: () => Promise<unknown>;
  adminBadges: { unreadMessages: number; pendingClaims: number };
};

const AppFeedsContext = createContext<AppFeeds | null>(null);

/**
 * The app-shell's background feeds, polled ONCE per tab: the notifications list
 * (bell badge + the /notifications page used to poll it separately) and the
 * super-admin nav badges (previously polled by each mounted NavList — the
 * desktop sidebar and the mobile drawer).
 */
export function AppFeedsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("super_admin") ?? false;

  const {
    data: notifications,
    loading: notificationsLoading,
    error: notificationsError,
    refetch,
  } = useAsync(listNotifications, { refetchInterval: 15000 });

  const [adminBadges, setAdminBadges] = useState({ unreadMessages: 0, pendingClaims: 0 });

  const loadAdminBadges = useCallback(async () => {
    if (!isAdmin) return;
    const [messages, claims] = await Promise.all([listContactMessages(), listPaymentClaims("pending")]);
    setAdminBadges({ unreadMessages: messages.unread, pendingClaims: claims.length });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadAdminBadges().catch(() => {});
    const onRefresh = () => void loadAdminBadges().catch(() => {});
    window.addEventListener(ADMIN_BADGES_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(ADMIN_BADGES_REFRESH_EVENT, onRefresh);
  }, [isAdmin, loadAdminBadges]);

  usePolling(loadAdminBadges, isAdmin ? 30000 : null);

  const refetchNotifications = useCallback(() => refetch({ silent: true }), [refetch]);

  return (
    <AppFeedsContext.Provider
      value={{ notifications, notificationsLoading, notificationsError, refetchNotifications, adminBadges }}
    >
      {children}
    </AppFeedsContext.Provider>
  );
}

export function useAppFeeds(): AppFeeds {
  const ctx = useContext(AppFeedsContext);
  if (!ctx) throw new Error("useAppFeeds must be used within an AppFeedsProvider");
  return ctx;
}
