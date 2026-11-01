"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n/context";
import { apiErrorMessage } from "@/lib/api/error-message";
import {
  getUberLoginSettings,
  rotateUberInboundAddress,
  updateUberLoginSettings,
  type UberLoginSettings,
} from "@/lib/api/uber-login";

/**
 * Variant B setup (docs/27): the company forwards Uber's code email to a secret address and
 * Reidey types the code itself. The address is shown once (only its hash is stored); the
 * manager copies it into the forwarding filter of the mailbox that receives Uber's codes.
 */
export function UberAutoCodeSettings() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.connections.${k}`);
  const [settings, setSettings] = useState<UberLoginSettings | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getUberLoginSettings()
      .then((s) => {
        setSettings(s);
        setEmail(s.email ?? "");
      })
      .catch(() => {});
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast.error(apiErrorMessage(e, t, locale));
    } finally {
      setBusy(false);
    }
  }

  const save = (input: Parameters<typeof updateUberLoginSettings>[0]) =>
    run(async () => {
      setSettings(await updateUberLoginSettings(input));
      toast.success(c("autoSaved"));
    });

  const rotate = () =>
    run(async () => {
      setAddress(await rotateUberInboundAddress());
      setSettings(await getUberLoginSettings());
    });

  if (!settings) return null;

  return (
    <div className="mt-6 space-y-4 border-t border-line pt-5">
      <div>
        <h4 className="text-sm font-semibold text-ink">{c("autoTitle")}</h4>
        <p className="mt-1 text-sm text-ink-muted">{c("autoHint")}</p>
      </div>

      <div className="space-y-2">
        <Button variant="secondary" size="sm" onClick={rotate} disabled={busy}>
          {settings.inbound_configured ? c("autoRotate") : c("autoCreate")}
        </Button>
        {address && (
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-xs text-ink-muted">{c("autoAddressOnce")}</p>
            <div className="mt-1 flex items-center gap-2" dir="ltr">
              <code className="min-w-0 flex-1 break-all text-sm text-ink">{address}</code>
              <Button
                variant="ghost"
                size="sm"
                aria-label={c("autoCopy")}
                onClick={() => navigator.clipboard.writeText(address).then(() => toast.success(c("autoCopied")))}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ email: email.trim() || null });
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={c("codeEmail")}
          aria-label={c("codeEmail")}
          dir="ltr"
          className="min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-line"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={busy}>
          {c("autoSave")}
        </Button>
      </form>

      <label className="flex items-center justify-between gap-3 text-sm text-ink">
        <span>{c("autoCodeLabel")}</span>
        <Switch
          checked={settings.auto_code}
          disabled={busy || !settings.inbound_configured}
          label={c("autoCodeLabel")}
          onChange={() => save({ auto_code: !settings.auto_code })}
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm text-ink">
        <span>{c("autoReloginLabel")}</span>
        <Switch
          checked={settings.auto_relogin}
          disabled={busy || !settings.auto_code || !settings.email}
          label={c("autoReloginLabel")}
          onChange={() => save({ auto_relogin: !settings.auto_relogin })}
        />
      </label>
    </div>
  );
}
