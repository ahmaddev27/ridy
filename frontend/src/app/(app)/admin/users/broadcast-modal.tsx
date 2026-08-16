"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { broadcastNotification, type BroadcastInput } from "@/lib/api/admin";

type Audience = "all" | "role" | "selected";

/** Roles a broadcast may target (mirrors the backend whitelist). */
const ROLES = ["super_admin", "owner", "fleet_manager", "driver", "viewer", "reseller"] as const;

export function BroadcastModal({
  open,
  onClose,
  selectedIds,
  t,
  roleLabel,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: number[];
  /** Translator scoped to `screens.users.broadcast.*`. */
  t: (k: string) => string;
  /** Localized label for a role key (e.g. "super_admin" → "Admin"). */
  roleLabel: (role: string) => string;
}) {
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
      (audience === "selected" && selectedIds.length > 0));

  async function submit() {
    if (audience === "selected" && selectedIds.length === 0) {
      toast.error(t("noRecipients"));
      return;
    }
    setBusy(true);
    try {
      const input: BroadcastInput = { title: title.trim(), body: body.trim() };
      if (href.trim()) input.href = href.trim();
      if (audience === "all") input.all = true;
      else if (audience === "role") input.role = role;
      else input.user_ids = selectedIds;

      const { queued } = await broadcastNotification(input);
      toast.success(t("queued").replace("{n}", String(queued)));
      reset();
      onClose();
    } catch (e) {
      toast.error(t("failed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  const audienceBtn = (mode: Audience, label: string) => (
    <button
      type="button"
      onClick={() => setAudience(mode)}
      className={
        "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors " +
        (audience === mode ? "bg-primary text-primary-ink" : "bg-surface-2 text-ink-muted hover:bg-surface-2")
      }
    >
      {label}
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("title")}
      size="lg"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-2"
          >
            {t("cancel")}
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit || busy}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-ink disabled:opacity-50"
          >
            {t("submit")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink">{t("audience")}</label>
          <div className="flex flex-wrap gap-1.5">
            {audienceBtn("all", t("audAll"))}
            {audienceBtn("role", t("audRole"))}
            {audienceBtn("selected", `${t("audSelected")} (${selectedIds.length})`)}
          </div>
          {audience === "role" && (
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">{t("selectRolePlaceholder")}</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          )}
          {audience === "selected" && selectedIds.length === 0 && (
            <p className="mt-2 text-xs text-ink-subtle">{t("selectHint")}</p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink">{t("fieldTitle")}</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink">{t("fieldBody")}</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            rows={4}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink">{t("fieldHref")}</label>
          <input
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder={t("hrefPlaceholder")}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </div>
      </div>
    </Modal>
  );
}
