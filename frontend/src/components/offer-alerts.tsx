"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/auth-provider";
import { useI18n } from "@/lib/i18n/context";
import { listOffers, type DispatchOffer } from "@/lib/api/offers";

/**
 * App-wide new-offer watcher. Polls the offers feed every few seconds and, for
 * any offer not seen before, fires a toast + a short beep — so a manager is
 * alerted on ANY page. A near-real-time popup with zero extra infrastructure;
 * upgradeable to a WebSocket push later. Runs only for company managers
 * (the super-admin has no tenant / offers).
 */
export function OfferAlerts() {
  const { user } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const seen = useRef<Set<number>>(new Set());
  const primed = useRef(false);

  const isManager = Boolean(user?.tenant);

  useEffect(() => {
    if (!isManager) return;
    let stopped = false;

    async function poll() {
      try {
        const offers = await listOffers();
        // First pass just records the current state — never toast the backlog.
        if (!primed.current) {
          offers.forEach((o) => seen.current.add(o.id));
          primed.current = true;
          return;
        }
        // Feed comes newest-first; announce oldest-to-newest.
        offers
          .filter((o) => !seen.current.has(o.id))
          .reverse()
          .forEach((o) => {
            seen.current.add(o.id);
            announce(o);
          });
      } catch {
        /* transient — try again next tick */
      }
    }

    function announce(o: DispatchOffer) {
      beep();
      const parts = [o.rider_first_name, o.fare_formatted, o.pickup_address].filter(Boolean).join(" · ");
      toast(t("common.newOffer"), {
        description: parts || undefined,
        action: { label: t("common.view"), onClick: () => router.push("/offers") },
        duration: 8000,
      });
    }

    poll();
    const id = setInterval(() => !stopped && poll(), 5000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [isManager, t, router]);

  return null;
}

// Short two-tone beep via the Web Audio API — no asset needed. Browsers may
// gate audio until the first user gesture; failures are ignored silently.
let audioCtx: AudioContext | null = null;
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = audioCtx ?? new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1175, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.31);
  } catch {
    /* audio unavailable */
  }
}
