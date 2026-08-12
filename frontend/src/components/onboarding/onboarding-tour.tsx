"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Plug, Radio, Users, Map, CreditCard, ArrowRight, ArrowLeft, X, type LucideIcon } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useI18n } from "@/lib/i18n/context";

const STORAGE_KEY = "reidey_onboarding_v1";

/** Event a "?" button can dispatch to replay the tour on demand. */
export const ONBOARDING_EVENT = "reidey:onboarding";

type Step = { icon: LucideIcon; key: string };

const STEPS: Step[] = [
  { icon: Sparkles, key: "welcome" },
  { icon: Plug, key: "connect" },
  { icon: Radio, key: "offers" },
  { icon: Users, key: "drivers" },
  { icon: Map, key: "map" },
  { icon: CreditCard, key: "billing" },
];

/** Reveals `text` character by character; `complete()` jumps to the full text. */
function useTypewriter(text: string, speed = 22) {
  const [out, setOut] = useState("");
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setOut("");
    setDone(false);
    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) {
        if (timer.current) clearInterval(timer.current);
        setDone(true);
      }
    }, speed);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [text, speed]);

  const complete = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    setOut(text);
    setDone(true);
  }, [text]);

  return { out, done, complete };
}

/**
 * First-login guided tour for company managers: a branded pop-up that types out
 * a short explanation of each part of the system. Shown once (persisted), and
 * replayable via the ONBOARDING_EVENT. Fully translated + RTL-aware.
 */
export function OnboardingTour() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const o = (k: string) => t(`onboarding.${k}`);

  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  // Only fleet users (a tenant) get onboarding — not super-admins/resellers.
  const isManager = Boolean(user?.tenant);

  // Auto-open once per browser after the first successful login.
  useEffect(() => {
    if (loading || !isManager) return;
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      /* ignore */
    }
  }, [loading, isManager]);

  // Allow a "?" button to replay it.
  useEffect(() => {
    const replay = () => {
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(ONBOARDING_EVENT, replay);
    return () => window.removeEventListener(ONBOARDING_EVENT, replay);
  }, []);

  const step = STEPS[index];
  const { out, done, complete } = useTypewriter(open ? o(`${step.key}Body`) : "");

  function finish() {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function next() {
    if (!done) {
      complete();
      return;
    }
    if (index >= STEPS.length - 1) finish();
    else setIndex((i) => i + 1);
  }

  if (!open || !isManager) return null;

  const Icon = step.icon;
  const isLast = index === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            {o("badge")}
          </span>
          <button
            onClick={finish}
            className="rounded-lg p-1.5 text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label={o("skip")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div
          className="cursor-pointer px-6 py-7 text-center"
          onClick={() => !done && complete()}
          title={done ? undefined : o("tapToReveal")}
        >
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-ink">
            <Icon className="h-7 w-7" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-ink">{o(`${step.key}Title`)}</h2>
          <p className="mt-2 min-h-[4.5rem] text-sm leading-relaxed text-ink-muted">
            {out}
            {!done && <span className="ms-0.5 inline-block h-4 w-0.5 animate-pulse bg-ink-muted align-middle" />}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 pb-4">
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-primary" : "w-1.5 bg-line-strong"}`}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-2 px-5 py-3">
          <button
            onClick={finish}
            className="text-sm font-medium text-ink-subtle transition-colors hover:text-ink"
          >
            {o("skip")}
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                onClick={() => setIndex((i) => i - 1)}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              >
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                {o("back")}
              </button>
            )}
            <button
              onClick={next}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-ink shadow-sm transition-opacity hover:opacity-90"
            >
              {isLast ? o("finish") : o("next")}
              {!isLast && <ArrowRight className="h-4 w-4 rtl:rotate-180" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
