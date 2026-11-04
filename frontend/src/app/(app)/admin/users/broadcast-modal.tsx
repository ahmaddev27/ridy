"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { apiErrorMessage } from "@/lib/api/error-message";
import { Modal } from "@/components/ui/modal";
import { broadcastNotification, type BroadcastInput, type PlatformUser } from "@/lib/api/admin";

type Audience = "all" | "role" | "selected";

/** Roles a broadcast may target (mirrors the backend whitelist). */
const ROLES = ["super_admin", "owner", "fleet_manager", "driver", "viewer", "reseller"] as const;

export function BroadcastModal({
  open,
  onClose,
  selected,
  t,
  roleLabel,
}: {
  open: boolean;
  onClose: () => void;
  selected: PlatformUser[];
  /** Translator scoped to `screens.users.broadcast.*`. */
  t: (k: string) => string;
  /** Localized label for a role key (e.g. "super_admin" → "Admin"). */
  roleLabel: (role: string) => string;
}) {
  const i18n = useI18n();
  const [audience, setAudience] = useState<Audience>("selected");
  const [role, setRole] = useState<string>("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setTitle("");
    setBody("");
    setHref("");
    setRole("");
    setAudience("selected");
  }

  const canSubmit =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (audience === "all" ||
      (audience === "role" && role !== "") ||
      (audience === "selected" && selected.length > 0));

  async function submit() {
    if (audience === "selected" && selected.length === 0) {
      toast.error(t("noRecipients"));
      return;
    }
    setBusy(true);
    try {
      const input: BroadcastInput = { title: title.trim(), body: body.trim() };
      if (href.trim()) input.href = href.trim();
      if (audience === "all") input.all = true;
      else if (audience === "role") input.role = role;
      else {
        // Split the selection back into its two id spaces.
        input.user_ids = selected.filter((u) => u.kind === "user").map((u) => u.id);
        input.driver_ids = selected.filter((u) => u.kind === "driver").map((u) => u.id);
      }

      const { queued } = await broadcastNotification(input);
      toast.success(t("queued").replace("{n}", String(queued)));
      reset();
      onClose();
    } catch (e) {
      toast.error(t("failed"), { description: apiErrorMessage(e, i18n.t) });
    } finally {
      setBusy(false);
    }
  }

  const audienceBtn = (mode: Audience, label: string) => (
    <button type="button" onClick={() => setAudience(mode)} className={audience === mode ? "on" : ""} aria-pressed={audience === mode}>
      {label}
    </button>
  );

  const names = selected.map((u) => u.name);
  const selectedHint =
    selected.length === 0 ? t("selectHint") : selected.length <= 3 ? names.join(", ") : t("selectedCount").replace("{n}", String(selected.length));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("title")}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-secondary">
            {t("cancel")}
          </button>
          <button type="button" onClick={submit} disabled={!canSubmit || busy} className="btn btn-primary">
            <Send />
            {t("submit")}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <span className="strong text-sm">{t("audience")}</span>
          <div className="seg self-start" role="group" aria-label={t("audience")}>
            {audienceBtn("all", t("audAll"))}
            {audienceBtn("role", t("audRole"))}
            {audienceBtn("selected", `${t("audSelected")} (${selected.length})`)}
          </div>
          {audience === "selected" && <span className="hint">{selectedHint}</span>}
        </div>

        {audience === "role" && (
          <div className="field">
            <select value={role} onChange={(e) => setRole(e.target.value)} className="select" aria-label={t("audRole")}>
              <option value="">{t("selectRolePlaceholder")}</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label>{t("fieldTitle")}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="input" />
        </div>

        <div className="field">
          <label>{t("fieldBody")}</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={4} className="textarea" />
        </div>

        <div className="field">
          <label>{t("fieldHref")}</label>
          <input value={href} onChange={(e) => setHref(e.target.value)} placeholder={t("hrefPlaceholder")} className="input" dir="ltr" />
        </div>
      </div>
    </Modal>
  );
}
