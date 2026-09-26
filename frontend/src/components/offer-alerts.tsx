"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/auth-provider";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale } from "@/lib/utils";
import { listOffers, getOffer, fareLabel, type DispatchOffer, type DispatchOfferDetail } from "@/lib/api/offers";
import { useCompanyRealtime, type OfferChangedPayload } from "@/lib/realtime";
import { usePolling } from "@/hooks/use-polling";

/** Window event the offers page listens for to open an offer's detail in place. */
export const OPEN_OFFER_EVENT = "reidey:open-offer";

// Poll cadence — the same whether or not the Reverb socket is up: the backend
// only broadcasts "new" for offers of a LINKED driver, so the poll is the only
// alert path for an unlinked driver's offer and must stay near real time.
// Hidden tabs keep polling so alerts still sound in a background tab.
const POLL_MS = 5_000;

const CLAIM_PREFIX = "offerAlert:";
const CLAIM_TTL_MS = 60 * 60 * 1000;

/**
 * Only one open tab may beep/toast for a given offer. The claim is a
 * localStorage mark taken under a Web Lock (atomic across tabs where supported).
 */
async function claimAlert(offerId: number): Promise<boolean> {
  const key = `${CLAIM_PREFIX}${offerId}`;
  const tryClaim = (): boolean => {
    try {
      if (localStorage.getItem(key)) return false;
      localStorage.setItem(key, String(Date.now()));
      return true;
    } catch {
      return true; // storage blocked: this tab alerts on its own
    }
  };
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    try {
      return await locks.request("reidey-offer-alerts", () => tryClaim());
    } catch {
      /* fall through */
    }
  }
  return tryClaim();
}

function pruneClaims(): void {
  try {
    const cutoff = Date.now() - CLAIM_TTL_MS;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(CLAIM_PREFIX) && Number(localStorage.getItem(key)) < cutoff) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * App-wide new-offer watcher: a toast + a short beep for every new offer, on ANY
 * page. Driven by the company's Reverb channel (`.offer.changed`, reason "new");
 * a slow list poll remains as the safety net when the socket is down. Runs only
 * for company managers (the super-admin has no tenant / offers).
 */
export function OfferAlerts() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const seen = useRef<Set<number>>(new Set());
  const primed = useRef(false);

  const tenantId = user?.tenant?.id ?? null;
  const isManager = tenantId != null;

  useEffect(() => {
    if (isManager) pruneClaims();
  }, [isManager]);

  const openOffer = useCallback(
    (id: number) => {
      // Already on /offers: open the detail in place (a push to the same route
      // with a new ?offer= would not re-run the page's deep-link handling).
      if (pathnameRef.current === "/offers") {
        window.dispatchEvent(new CustomEvent<number>(OPEN_OFFER_EVENT, { detail: id }));
      } else {
        router.push(`/offers?offer=${id}`);
      }
    },
    [router],
  );

  const announce = useCallback(
    (o: DispatchOffer, detail: DispatchOfferDetail | null) => {
      beep();
      const distanceKm = detail?.trip?.distance_km ?? null;
      const pricePerKm = detail?.trip?.price_per_km ?? null;
      const numberLocale = latnLocale(locale);

      const line1 = [
        fareLabel(o, numberLocale),
        distanceKm != null ? `${distanceKm.toLocaleString(numberLocale)} km` : null,
        pricePerKm != null
          ? `${pricePerKm.toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/km`
          : null,
      ].filter(Boolean).join(" · ");
      const line2 = [o.driver_name, o.rider_first_name].filter(Boolean).join(" · ");
      const line3 = [o.pickup_address, o.dropoff_address].filter(Boolean).join(" · ");

      toast(t("common.newOffer"), {
        description: (
          <div className="w-full min-w-0 space-y-0.5 text-start">
            {line1 && <div className="truncate font-semibold text-ink">{line1}</div>}
            {line2 && <div className="truncate text-ink-muted">{line2}</div>}
            {line3 && <div className="line-clamp-2 break-words text-xs text-ink-subtle">{line3}</div>}
          </div>
        ),
        action: { label: t("common.view"), onClick: () => openOffer(o.id) },
        duration: 9000,
      });
    },
    [locale, t, openOffer],
  );

  /** Record + (if this tab wins the claim) announce one new offer. */
  const handleNew = useCallback(
    async (id: number, known?: DispatchOffer) => {
      if (seen.current.has(id)) return;
      seen.current.add(id);
      if (!(await claimAlert(id))) return;
      // Enrich with the geocoded trip (distance + price/km) — best-effort so a
      // slow/failed geocode never blocks the alert.
      let detail: DispatchOfferDetail | null = null;
      try {
        detail = await getOffer(id);
      } catch {
        /* show what we have */
      }
      const offer = detail ?? known;
      if (offer) announce(offer, detail);
    },
    [announce],
  );

  useCompanyRealtime(tenantId, (payload) => {
    const { offer_id: offerId, reason } = (payload ?? {}) as OfferChangedPayload;
    if (reason !== "new" || typeof offerId !== "number") return;
    void handleNew(offerId);
  });

  const poll = useCallback(async () => {
    const offers = await listOffers();
    // First pass just records the current state — never toast the backlog.
    if (!primed.current) {
      offers.forEach((o) => seen.current.add(o.id));
      primed.current = true;
      return;
    }
    // Feed comes newest-first; announce oldest-to-newest.
    for (const o of offers.filter((x) => !seen.current.has(x.id)).reverse()) {
      await handleNew(o.id, o);
    }
  }, [handleNew]);

  // Prime immediately so realtime/poll alerts only cover offers from now on.
  useEffect(() => {
    if (!isManager) return;
    void poll().catch(() => {});
  }, [isManager, poll]);

  usePolling(poll, isManager ? POLL_MS : null, { whenHidden: POLL_MS });

  return null;
}

// Short two-tone beep via the Web Audio API — no asset needed. Browsers may
// gate audio until the first user gesture; failures are ignored silently.
let audioCtx: AudioContext | null = null;
function beep() {
  try {
    // Respect the manager's mute toggle (persisted in localStorage).
    if (localStorage.getItem("offerSoundMuted") === "1") return;
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
