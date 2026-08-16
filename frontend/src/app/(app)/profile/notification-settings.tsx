"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Loader2, Mail, MonitorSmartphone, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import {
  getNotificationPrefs,
  updateNotificationPrefs,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPrefs,
} from "@/lib/api/notifications";

const CHANNELS: NotificationChannel[] = ["push", "email"];

/**
 * Per-category delivery matrix. The in-app bell column is always shown as an
 * enabled, disabled control (it can never be turned off); the user toggles web
 * push and email per category. Saving PUTs the full matrix.
 */
export function NotificationSettings() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.notifPrefs.${k}`);

  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getNotificationPrefs()
      .then((p) => active && setPrefs(p))
      .catch(() => active && toast.error(c("loadError")))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(channel: NotificationChannel, category: NotificationCategory) {
    setPrefs((prev) =>
      prev
        ? { ...prev, [channel]: { ...prev[channel], [category]: !prev[channel][category] } }
        : prev,
    );
  }

  async function save() {
    if (!prefs) return;
    setBusy(true);
    try {
      const saved = await updateNotificationPrefs(prefs);
      setPrefs(saved);
      toast.success(c("saved"));
    } catch (e) {
      toast.error(c("saveFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  if (loading || !prefs) {
    return (
      <div className="flex items-center justify-center py-10 text-ink-subtle">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-ink">{c("title")}</h2>
        <p className="mt-1 text-sm text-ink-subtle">{c("subtitle")}</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line/70">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-line/70 bg-surface-2 text-ink-muted">
              <th className="px-4 py-3 text-start font-medium">{c("colCategory")}</th>
              <Th icon={<Bell className="h-4 w-4" />} label={c("colBell")} />
              <Th icon={<MonitorSmartphone className="h-4 w-4" />} label={c("colPush")} />
              <Th icon={<Mail className="h-4 w-4" />} label={c("colEmail")} />
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((category) => (
              <tr key={category} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{c(`cat_${category}`)}</div>
                  <div className="text-xs text-ink-subtle">{c(`cat_${category}_desc`)}</div>
                </td>
                <td className="px-4 py-3 text-center">
                  <Toggle checked disabled label={c("bellAlways")} />
                </td>
                {CHANNELS.map((channel) => (
                  <td key={channel} className="px-4 py-3 text-center">
                    <Toggle
                      checked={prefs[channel][category]}
                      onChange={() => toggle(channel, category)}
                      label={`${c(`col${channel === "push" ? "Push" : "Email"}`)} · ${c(`cat_${category}`)}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {c("save")}
        </Button>
      </div>
    </div>
  );
}

function Th({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <th className="px-4 py-3 font-medium">
      <span className="flex flex-col items-center gap-1 text-ink-muted">
        {icon}
        <span className="text-xs">{label}</span>
      </span>
    </th>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange?: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onChange}
      disabled={disabled}
      className={
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-line " +
        (checked ? "bg-primary" : "bg-line-strong") +
        (disabled ? " cursor-not-allowed opacity-60" : " cursor-pointer")
      }
    >
      <span
        className={
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ltr:ml-1 rtl:mr-1 " +
          (checked ? "ltr:translate-x-5 rtl:-translate-x-5" : "translate-x-0")
        }
      />
    </button>
  );
}
