"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Link2, Hourglass, CheckCircle2, Copy, AlertTriangle, KeyRound, Unlink } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { ApiError } from "@/lib/api/client";
import { latnLocale } from "@/lib/utils";
import {
  getElProfessorConnection,
  setElProfessorGalleryImport,
  setElProfessorOdometerRequired,
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
  const [savingGallery, setSavingGallery] = useState(false);
  const [savingOdometer, setSavingOdometer] = useState(false);

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

  /**
   * Turn gallery import on or off for this company's drivers.
   *
   * No confirmation either way: nothing is destroyed and nothing is revoked
   * — the next receipt simply offers one button or two. That is the opposite
   * of the platform's own switch, which ends a connection and asks first.
   */
  async function toggleGallery() {
    if (!data) return;
    const next = !data.gallery_import;
    setSavingGallery(true);
    try {
      await setElProfessorGalleryImport(next);
      toast.success(next ? c("epGalleryOnToast") : c("epGalleryOffToast"));
      await refetch();
    } catch (e) {
      failure(e, "epGalleryFailed");
    } finally {
      setSavingGallery(false);
    }
  }

  /** Turn the odometer step on or off for this company's drivers. */
  async function toggleOdometer() {
    if (!data) return;
    const next = !data.odometer_required;
    setSavingOdometer(true);
    try {
      await setElProfessorOdometerRequired(next);
      toast.success(next ? c("epOdometerOnToast") : c("epOdometerOffToast"));
      await refetch();
    } catch (e) {
      failure(e, "epOdometerFailed");
    } finally {
      setSavingOdometer(false);
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

  const spin = { animation: "ofr-spin 1s linear infinite" };
  const tone = data?.connected ? "success" : waiting ? "warning" : "";

  return (
    <section className="card">
      <div className="card-head">
        <h2>{c("epTitle")}</h2>
      </div>
      <div className="card-body stack">
        <p className="muted">{c("epIntro")}</p>

        {loading ? (
          <div className="stack">
            <span className="skel" style={{ height: 14, width: "90%" }} />
            <span className="skel" style={{ height: 14, width: "70%" }} />
            <span className="skel" style={{ height: 80 }} />
          </div>
        ) : error || !data ? (
          <div className="callout danger">
            <AlertTriangle />
            <div className="stack-sm">
              <span>{c("epLoadFailed")}</span>
              <span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => refetch({ silent: false })}>
                  {t("common.retry")}
                </button>
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="row" style={{ gap: 16, alignItems: "center", padding: 16, border: "1px solid var(--line)", borderRadius: "var(--r-xl)", background: "var(--surface-2)" }}>
              <span className={`chip-big ${tone}`}>
                {data.connected ? <CheckCircle2 /> : waiting ? <Hourglass /> : <Link2 />}
              </span>
              <div>
                <div className="strong" style={{ fontSize: 16 }}>
                  {data.connected ? c("epConnectedTitle") : waiting ? c("epWaitingTitle") : c("epNotConnectedTitle")}
                </div>
                <div className="muted text-sm">
                  {data.connected
                    ? lastUsed
                      ? c("epLastUsed").replace("{date}", lastUsed)
                      : ""
                    : waiting
                      ? c("epWaitingBody")
                      : c("epNotConnectedBody")}
                </div>
              </div>
            </div>

            {issued && (
              <div className="stack-sm">
                <label className="strong text-sm" htmlFor="ep-token">{c("epTokenLabel")}</label>
                <div className="row" style={{ gap: 8, alignItems: "stretch" }}>
                  <div className="tok" id="ep-token" tabIndex={0}>{issued.token}</div>
                  <button type="button" className="icon-btn" onClick={copyToken} title={c("epCopy")} aria-label={c("epCopy")}>
                    <Copy />
                  </button>
                </div>
                <div className="callout warning">
                  <AlertTriangle />
                  <div>{c("epTokenOnce")}</div>
                </div>
                <dl className="kv">
                  <dt>{c("epFleet")}</dt>
                  <dd>{issued.tenant_name}</dd>
                  <dt>{c("epPaymentRef")}</dt>
                  <dd className="mono" dir="ltr">{issued.payment_reference}</dd>
                </dl>
              </div>
            )}

            <div className="row-wrap">
              <button type="button" className="btn btn-primary" onClick={generate} disabled={busy}>
                {busy ? <Loader2 style={spin} /> : <KeyRound />}
                {hasLiveToken ? c("epRegenerate") : c("epGenerate")}
              </button>
              {hasLiveToken && (
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmRevoke(true)} disabled={busy}>
                  <Unlink />
                  {c("epRevoke")}
                </button>
              )}
            </div>
          </>
        )}

        {/* The company's own settings, shown once the platform has opened the
            integration. Before that there is nothing for them to govern. */}
        {!loading && data?.enabled && (
          <div className="stack-sm">
            <div className="card inset" style={{ padding: "14px 16px" }}>
              <div className="setting">
                <div>
                  <div className="t">{c("epGalleryTitle")}</div>
                  <div className="d">{c("epGalleryBody")}</div>
                </div>
                <Switch
                  checked={data.gallery_import}
                  onChange={() => void toggleGallery()}
                  disabled={savingGallery}
                  label={data.gallery_import ? c("epGalleryOff") : c("epGalleryOn")}
                />
              </div>
            </div>
            <div className="card inset" style={{ padding: "14px 16px" }}>
              <div className="setting">
                <div>
                  <div className="t">{c("epOdometerTitle")}</div>
                  <div className="d">{c("epOdometerBody")}</div>
                </div>
                <Switch
                  checked={data.odometer_required}
                  onChange={() => void toggleOdometer()}
                  disabled={savingOdometer}
                  label={data.odometer_required ? c("epOdometerOff") : c("epOdometerOn")}
                />
              </div>
            </div>
          </div>
        )}
      </div>

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
    </section>
  );
}
