"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Link2, Hourglass, CheckCircle2, Copy, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { ApiError } from "@/lib/api/client";
import { latnLocale } from "@/lib/utils";
import {
  getElProfessorConnection,
  issueElProfessorToken,
  revokeElProfessorToken,
  type ElProfessorToken,
} from "@/lib/api/elprofessor";

export function ElProfessorCard() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.connections.${k}`);
  const { data, loading, error, refetch } = useAsync(getElProfessorConnection);

  // The token only exists in memory, right after it was issued — the server
  // never returns it again.
  const [issued, setIssued] = useState<ElProfessorToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const failure = (e: unknown, fallbackKey: string) => {
    toast.error(e instanceof ApiError && e.status === 403 ? c("epForbidden") : c(fallbackKey), {
      description: e instanceof ApiError && e.status !== 403 ? e.message : undefined,
    });
  };

  async function generate() {
    setBusy(true);
    try {
      setIssued(await issueElProfessorToken());
      await refetch();
    } catch (e) {
      failure(e, "epGenerateFailed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await revokeElProfessorToken();
      setIssued(null);
      setConfirmRevoke(false);
      toast.success(c("epRevoked"));
      await refetch();
    } catch (e) {
      failure(e, "epRevokeFailed");
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      toast.success(c("epTokenCopied"));
    } catch {
      toast.error(c("epCopyFailed"));
    }
  }

  const lastUsed = data?.last_used_at
    ? new Intl.DateTimeFormat(latnLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(data.last_used_at),
      )
    : null;
  // A token exists (and is live) but nothing has pulled with it yet.
  const waiting = !!data && !data.connected && !!data.token_issued_at && !data.revoked_at && !data.first_used_at;
  const hasLiveToken = !!data && (data.connected || waiting);

  return (
    <Card className="p-8">
      <h2 className="text-lg font-semibold text-ink">{c("epTitle")}</h2>
      <p className="mt-1 text-sm text-ink-muted">{c("epIntro")}</p>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-ink-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error || !data ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-danger-bg px-4 py-3 text-sm text-danger-fg">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {c("epLoadFailed")}
          </span>
          <Button variant="secondary" size="sm" onClick={() => refetch({ silent: false })}>
            {t("common.retry")}
          </Button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center text-center">
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
              data.connected ? "bg-success-bg text-success-fg" : "bg-surface-2 text-ink-muted"
            }`}
          >
            {data.connected ? <CheckCircle2 className="h-7 w-7" /> : waiting ? <Hourglass className="h-7 w-7" /> : <Link2 className="h-7 w-7" />}
          </span>
          <h3 className="mt-4 text-lg font-semibold text-ink">
            {data.connected ? c("epConnectedTitle") : waiting ? c("epWaitingTitle") : c("epNotConnectedTitle")}
          </h3>
          <p className="mt-1 max-w-sm text-sm text-ink-muted">
            {data.connected
              ? lastUsed
                ? c("epLastUsed").replace("{date}", lastUsed)
                : ""
              : waiting
                ? c("epWaitingBody")
                : c("epNotConnectedBody")}
          </p>

          {issued && (
            <div className="mt-6 w-full max-w-md">
              <p className="text-xs font-medium text-ink-muted">{c("epTokenLabel")}</p>
              <div className="mt-1 flex items-center gap-2">
                <code
                  dir="ltr"
                  className="min-w-0 flex-1 select-all break-all rounded-xl bg-surface-2 px-4 py-3 text-start font-mono text-sm text-ink"
                >
                  {issued.token}
                </code>
                <button
                  type="button"
                  onClick={copyToken}
                  className="rounded-lg p-2 text-ink-subtle hover:bg-surface-2 hover:text-ink"
                  title={c("epCopy")}
                  aria-label={c("epCopy")}
                >
                  <Copy className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-2 text-sm text-warning-fg">{c("epTokenOnce")}</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-start text-sm">
                <dt className="text-ink-muted">{c("epFleet")}</dt>
                <dd className="text-ink">{issued.tenant_name}</dd>
                <dt className="text-ink-muted">{c("epPaymentRef")}</dt>
                <dd className="text-ink" dir="ltr">{issued.payment_reference}</dd>
              </dl>
            </div>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button onClick={generate} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {hasLiveToken ? c("epRegenerate") : c("epGenerate")}
            </Button>
            {hasLiveToken && (
              <Button variant="ghost" onClick={() => setConfirmRevoke(true)} disabled={busy}>
                {c("epRevoke")}
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmRevoke}
        title={c("epRevokeTitle")}
        message={c("epRevokeBody")}
        confirmLabel={c("epRevoke")}
        cancelLabel={t("common.cancel")}
        onConfirm={revoke}
        onCancel={() => setConfirmRevoke(false)}
        busy={busy}
        danger
      />
    </Card>
  );
}
