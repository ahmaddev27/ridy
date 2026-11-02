"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/ui/otp-input";
import { CobrowseViewer, type CobrowseEndReason } from "@/components/connections/cobrowse-viewer";
import { useI18n } from "@/lib/i18n/context";
import { apiErrorMessage } from "@/lib/api/error-message";
import {
  cancelUberLogin,
  closeCobrowse,
  getUberLoginStatus,
  openCobrowse,
  startUberLogin,
  submitUberLoginCode,
  type CobrowseTicket,
  type UberLoginFailure,
  type UberLoginStatus,
} from "@/lib/api/uber-login";

const CODE_LENGTH = 4;

/** m:ss with Latin digits, whatever the UI language. */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  return `${Math.floor(total / 60)}:${seconds}`;
}

function useRemaining(expiresAt: string | null, active: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, expiresAt]);
  return active && expiresAt ? new Date(expiresAt).getTime() - now : null;
}

const KNOWN_CHANNELS = ["email", "sms", "whatsapp", "call"];

/** A known channel name, or null when the backend does not know where the code went. */
function knownChannel(channel: string | null | undefined): string | null {
  return channel && KNOWN_CHANNELS.includes(channel) ? channel : null;
}

/** The code was rejected and the flow moved on to a different channel (status.channel changed). */
function hasSwitchedChannel(previous: string | null | undefined, next: UberLoginStatus): boolean {
  const before = knownChannel(previous);
  const after = knownChannel(next.channel);
  return next.state === "awaiting_code" && before !== null && after !== null && before !== after;
}

/**
 * Passwordless Uber sign-in, human OTP relay (docs/27 variant A): the manager enters
 * the Uber account email, Uber sends a code, the manager types it here. The backend
 * relays it — this page never talks to the sign-in service, never sees a login id, and
 * the code is held in component state only until it is submitted.
 */
export function UberCodeLogin({ onConnected }: { onConnected: () => void }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.connections.${k}`);

  const [status, setStatus] = useState<UberLoginStatus | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrongCode, setWrongCode] = useState(false);
  const [channelSwitched, setChannelSwitched] = useState(false);
  const [ticket, setTicket] = useState<CobrowseTicket | null>(null);
  const [cobrowseFailed, setCobrowseFailed] = useState(false);

  const waiting = status?.state === "awaiting_code";
  const sentChannel = knownChannel(status?.channel);
  // Uber (or the sign-in service) is still working, e.g. after a timeout: never race it.
  const challenge = status?.state === "awaiting_challenge";
  const inFlight = status?.state === "starting" || status?.state === "submitting" || challenge;
  const remaining = useRemaining(status?.expires_at ?? null, waiting);

  // While in flight, just watch: it settles to connected, or expires back to idle.
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => {
      getUberLoginStatus()
        .then((next) => {
          setStatus(next);
          if (next.state === "connected") {
            toast.success(c("codeSuccess"));
            onConnected();
          } else if (next.state === "idle") {
            onConnected(); // it may have landed after all; the page re-reads the session
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight]);

  // Resume an attempt that is still open (page reload mid-login).
  useEffect(() => {
    getUberLoginStatus().then(setStatus).catch(() => {});
  }, []);

  // The attempt ran out while the manager was reading their inbox.
  useEffect(() => {
    if (waiting && remaining !== null && remaining <= 0) {
      setStatus({ state: "failed", mode: "manual", channel: null, expires_at: null, failure: "code_timeout" });
      setCode("");
    }
  }, [waiting, remaining]);

  // Leaving the challenge step (solved, failed, cancelled) always tears the viewer down.
  useEffect(() => {
    if (!challenge) setTicket(null);
  }, [challenge]);

  // Back from the puzzle: re-read the status now (the flow continues to the code step).
  const onCobrowseEnded = (reason: CobrowseEndReason) => {
    if (reason !== "solved") return;
    setTicket(null);
    getUberLoginStatus().then(setStatus).catch(() => {});
  };

  async function openPuzzle() {
    setBusy(true);
    setCobrowseFailed(false);
    try {
      setTicket(await openCobrowse());
    } catch {
      setCobrowseFailed(true); // 409 / 429 / 503 cobrowse_unavailable
    } finally {
      setBusy(false);
    }
  }

  function closePuzzle() {
    setTicket(null);
    void closeCobrowse().catch(() => {});
  }

  async function run(action: () => Promise<UberLoginStatus>) {
    setBusy(true);
    try {
      const next = await action();
      setChannelSwitched(hasSwitchedChannel(status?.channel, next));
      setStatus(next);
      setWrongCode(next.retry === true);
      if (next.retry || next.state !== "awaiting_code") setCode("");
      if (next.state === "connected") {
        toast.success(c("codeSuccess"));
        onConnected();
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, t, locale));
    } finally {
      setBusy(false);
    }
  }

  const start = () => run(() => startUberLogin(email.trim()));
  const submit = () => run(() => submitUberLoginCode(code));
  const cancel = () => run(cancelUberLogin).then(() => setEmail(""));

  // Auto-submit as soon as all 4 digits are entered — no "confirm" click. Guarded so one code
  // is sent once; the ref resets when the boxes clear (a retry) so the next code fires too.
  const autoSubmitted = useRef("");
  useEffect(() => {
    if (code.length === 0) autoSubmitted.current = "";
    else if (waiting && !busy && code.length === CODE_LENGTH && autoSubmitted.current !== code) {
      autoSubmitted.current = code;
      submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, busy, waiting]);

  const failure: UberLoginFailure | undefined = status?.state === "failed" ? status.failure : undefined;
  const connected = status?.state === "connected";

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted">
          <KeyRound className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-ink">{c("codeTitle")}</h3>
          {!waiting && !inFlight && !connected && <p className="mt-1 text-sm text-ink-muted">{c("codeHint")}</p>}

          {failure && (
            <p role="alert" className="mt-3 rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-fg">
              {c(`codeFail_${failure}`)}
            </p>
          )}

          {challenge ? (
            <div className="mt-3 space-y-3">
              {ticket ? (
                <CobrowseViewer ticket={ticket} onEnded={onCobrowseEnded} onClose={closePuzzle} />
              ) : status?.cobrowse_available && !cobrowseFailed ? (
                <>
                  <p className="text-sm text-ink-muted">{c("cobrowseHint")}</p>
                  <Button onClick={openPuzzle} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {busy ? c("cobrowseOpening") : c("cobrowseOpen")}
                  </Button>
                </>
              ) : (
                <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-fg">
                  {c("codeFail_cobrowse_unavailable")}
                </p>
              )}
              {!ticket && (
                <Button variant="secondary" onClick={cancel} disabled={busy}>
                  {c("codeCancel")}
                </Button>
              )}
            </div>
          ) : inFlight ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> {c("codePending")}
            </p>
          ) : waiting ? (
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-sm font-medium text-ink">
                  {sentChannel ? c(`codeSentTitle_${sentChannel}`) : c("codeSentTitle")}
                </p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {sentChannel ? c(`codeSentHint_${sentChannel}`) : c("codeSentHint")}
                </p>
                {channelSwitched && sentChannel && (
                  <p role="status" className="mt-1 text-sm text-warning-fg">
                    {c("codeSwitched").replace("{channel}", c(`codeChannel_${sentChannel}`))}
                  </p>
                )}
                {status?.mode === "auto" && <p className="mt-1 text-sm text-ink-muted">{c("codeAutoHint")}</p>}
              </div>
              <OtpInput value={code} onChange={setCode} length={CODE_LENGTH} autoFocus disabled={busy} />
              {wrongCode && (
                <p role="alert" className="text-center text-sm text-danger-fg">
                  {c("codeWrong")}
                </p>
              )}
              {remaining !== null && (
                <p className="text-center text-xs text-ink-subtle" dir="ltr">
                  {c("codeExpires").replace("{time}", formatRemaining(remaining))}
                </p>
              )}
              <div className="flex justify-center gap-2">
                <Button onClick={submit} disabled={busy || code.length !== CODE_LENGTH}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {busy ? c("codeVerifying") : c("codeVerify")}
                </Button>
                <Button variant="secondary" onClick={cancel} disabled={busy}>
                  {c("codeCancel")}
                </Button>
              </div>
            </div>
          ) : connected ? (
            <p className="mt-3 text-sm text-success-fg">{c("codeSuccess")}</p>
          ) : (
            <form
              className="mt-4 flex flex-col gap-3 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && email.trim()) void start();
              }}
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={c("codeEmail")}
                aria-label={c("codeEmail")}
                autoComplete="email"
                dir="ltr"
                disabled={busy}
                className="min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-line disabled:opacity-50"
              />
              <Button type="submit" disabled={busy || !email.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {busy ? c("codeStarting") : failure ? c("codeAgain") : c("codeSend")}
              </Button>
            </form>
          )}
        </div>
      </div>
    </Card>
  );
}
