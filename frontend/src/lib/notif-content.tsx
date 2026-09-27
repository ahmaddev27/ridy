import { Plug, Building2, Ban, CheckCircle2, Gift, Clock, AlertTriangle, Ticket, Bell, Megaphone, Banknote, type LucideIcon } from "lucide-react";
import type { AppNotification } from "@/lib/api/notifications";
import { safeHref } from "@/lib/safe-href";

type Tone = "success" | "danger" | "warning" | "info" | "default";

/** Icon + color per notification type. */
const MAP: Record<string, { icon: LucideIcon; tone: Tone }> = {
  session_connected: { icon: Plug, tone: "success" },
  session_needs_relink: { icon: Plug, tone: "danger" },
  company_registered: { icon: Building2, tone: "success" },
  company_banned: { icon: Ban, tone: "danger" },
  subscription_activated: { icon: CheckCircle2, tone: "success" },
  subscription_free: { icon: Gift, tone: "success" },
  subscription_expiring: { icon: Clock, tone: "warning" },
  subscription_expired: { icon: AlertTriangle, tone: "danger" },
  proxy_expiring: { icon: Plug, tone: "warning" },
  code_activated: { icon: Ticket, tone: "success" },
  payment_claim: { icon: Banknote, tone: "warning" },
  admin_broadcast: { icon: Megaphone, tone: "info" },
};

const TONE_CHIP: Record<Tone, string> = {
  success: "bg-success-bg text-success-fg",
  danger: "bg-danger-bg text-danger-fg",
  warning: "bg-warning-bg text-warning-fg",
  info: "bg-info-bg text-info-fg",
  default: "bg-surface-2 text-ink-muted",
};

function interpolate(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

/**
 * Resolve a notification to its display (icon, color chip, localized title/body,
 * link). Known types are localized from `notif.<type>.*` + params; older/unknown
 * ones fall back to the stored pre-rendered strings.
 */
export function notifContent(n: AppNotification, t: (k: string) => string) {
  const cfg = n.type ? MAP[n.type] : undefined;
  if (!cfg || !n.type) {
    return { icon: Bell, chip: TONE_CHIP.default, title: n.title ?? "", body: n.body ?? "", href: safeHref(n.href) };
  }
  // A super-admin broadcast carries its own free-form copy in params — there is
  // no localized template to resolve, so render it verbatim.
  if (n.type === "admin_broadcast") {
    return {
      icon: cfg.icon,
      chip: TONE_CHIP[cfg.tone],
      title: String(n.params.title ?? n.title ?? ""),
      body: String(n.params.body ?? n.body ?? ""),
      href: safeHref(n.href),
    };
  }
  return {
    icon: cfg.icon,
    chip: TONE_CHIP[cfg.tone],
    title: interpolate(t(`notif.${n.type}.title`), n.params),
    body: interpolate(t(`notif.${n.type}.body`), n.params),
    href: safeHref(n.href),
  };
}
