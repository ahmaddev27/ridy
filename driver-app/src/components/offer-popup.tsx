import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import { FullWindowOverlay } from "react-native-screens";
import { Text } from "@/components/typography";
import { X } from "@/components/icons";
import { CountdownLabel, CountdownRing, acceptWindow, deadlineOf } from "@/components/countdown";
import { PrimaryButton, RouteBlock, SectionLabel, StatusBadge } from "@/components/ui";
import { api, ApiError, type Offer } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cleanAddress, distanceLabel, fareLabel, perKmLabel } from "@/lib/format";
import { isRTL, t, useLocale } from "@/lib/i18n";
import { subscribeLive, type LiveEvent, type LiveOfferPayload } from "@/lib/live";
import { alertOfferNow } from "@/lib/offer-alert";
import { isFreshOffer } from "@/lib/offer-freshness";
import { isDarkPalette, radius, useColors } from "@/lib/theme";

/**
 * The instant offer pop-up: an Uber offer lands and the decision is ON SCREEN,
 * by itself, with nothing to wait for.
 *
 * It renders only what Uber's dispatch payload gives away for free — fare, route,
 * rider, the window — all of it inlined on the `new` broadcast, so the first
 * paint costs ZERO requests. Distance and €/km need geocoding, so they are
 * absent at first and fill in place when they arrive; they never hold the
 * render, because the whole point is to be inside a window measured in seconds.
 *
 * There is exactly ONE action: decline. Accepting happens in the Uber Driver app
 * and nowhere else — the dispatch decline exists only so a "no" costs the driver
 * nothing on their acceptance rate.
 */

/** The size of the pop-up's ring — a compact echo of the detail screen's hero. */
const RING_SIZE = 150;
const RING_STROKE = 8;

/** How long the outcome stays up before the pop-up gets out of the way. */
const OUTCOME_CLOSE_MS = 4_000;
/** How long an untouched pop-up may sit over the app after its window closed. */
const IDLE_CLOSE_AFTER_DEADLINE_MS = 15_000;
/** Coming to the foreground emits `resume` twice (the app, then the socket's
 *  reconnect); one look for a waiting offer covers both. */
const RESUME_CHECK_GAP_MS = 5_000;

/** Where OUR request got to. Says nothing about the offer — see `statusLine`. */
type Phase = "idle" | "sending" | "sent" | "failed";

/**
 * Offers the driver has already settled in this app session: declined, dismissed
 * or timed out. They never pop up again, however many broadcasts arrive for them
 * (an offer is re-broadcast on every lifecycle step).
 */
const handled = new Set<number>();

/** A notification tap: the decision if the offer still is one, else `showDetail`. */
type TapRequest = { offerId: number; showDetail: () => void };

/** A tap that arrives before the host mounts (a cold start) waits here for it. */
let queuedTap: TapRequest | null = null;
let deliverTap: ((request: TapRequest) => void) | null = null;

/**
 * A notification tap: put the DECISION in front of the driver while the offer
 * still is one, and only otherwise open its detail screen (`showDetail`).
 *
 * The detail screen has no decline — that lives here and nowhere else — so a tap
 * that always went there left an iPhone driver with no way to decline at all: on
 * iOS the banner IS how the app is reached while Uber holds the screen, and a
 * suspended app never saw the broadcast that opens the pop-up. The tap resolves
 * before anything navigates, because on iOS a modal screen presented AFTER the
 * pop-up would cover it.
 */
export function openOfferFromNotification(offerId: number, showDetail: () => void): void {
  const request = { offerId, showDetail };
  if (deliverTap) deliverTap(request);
  else queuedTap = request;
}

/**
 * A pop-up is a decision: a still-pending offer inside its window that this
 * driver could decline right now. `can_decline` is the server's own answer, so it
 * is also the gate that carries the per-company flag all the way to the phone: a
 * company with declines switched off must never start seeing a full-screen modal,
 * and nobody should be shown a button whose only reply is "disabled".
 */
function isDecision(offer: Offer): boolean {
  return offer.status === "pending" && isFreshOffer(offer) && offer.can_decline === true;
}

/** The bare broadcast payload as an `Offer`, so one model feeds every surface. */
function offerFromPayload(offerId: number, payload: LiveOfferPayload): Offer {
  return {
    id: offerId,
    offer_uuid: payload.offerUuid ?? "",
    status: "pending",
    rider_name: payload.riderName,
    pickup_address: payload.pickup,
    dropoff_address: payload.dropoff,
    fare_formatted: payload.fare,
    fare_amount: payload.fareAmount,
    // Geocoded, so never on the fast path: the metrics row stays hidden until
    // the enrichment (or a later broadcast) brings it.
    distance_m: null,
    accept_window_seconds: payload.acceptWindow,
    received_at: payload.receivedAt,
    offer_generated_at: payload.offerGeneratedAt,
  };
}

/**
 * Mounts the pop-up once, over every screen, and decides when it opens.
 *
 * Only for a signed-in DRIVER: the trigger is the private `driver.{id}` channel,
 * which a fleet owner's session has no part in, and the decline is the driver's
 * own offer to decline.
 */
export function OfferPopupHost() {
  const { driver, isOwner } = useAuth();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<string | null>(null);

  // The live subscription must see the CURRENT open offer without being torn
  // down and rebuilt on every state change (which would drop events mid-window).
  const openId = useRef<number | null>(null);
  useEffect(() => {
    openId.current = offer?.id ?? null;
  }, [offer]);

  /** Pull the server's own view over the bare payload: status, can_decline, and
   *  the geocoded metrics once they exist. Best-effort — a failed refresh leaves
   *  a decision the driver can still make on what we already showed. */
  const enrich = useCallback(async (id: number) => {
    try {
      const r = await api.offer(id);
      setOffer((prev) => (prev && prev.id === id ? { ...prev, ...r.data } : prev));
    } catch {
      /* the inline payload is enough to decide on */
    }
  }, []);

  const reject = useCallback(
    async (target: Offer) => {
      setPhase("sending");
      setFailure(null);
      try {
        const r = await api.dispatchRejectOffer(target.id);
        if (r.data?.status === "refused") {
          setPhase("failed");
          setFailure(r.data?.reason ?? null);
          return;
        }
        // queued / duplicate / already_declined: the panel has it. Uber's own
        // answer lands later over the driver channel — we never wait for it.
        setPhase("sent");
        handled.add(target.id);
        void enrich(target.id);
      } catch (e) {
        setPhase("failed");
        setFailure(e instanceof ApiError ? e.message : null);
      }
    },
    [enrich],
  );

  const open = useCallback(
    (next: Offer) => {
      if (handled.has(next.id)) return;
      // Claimed NOW, not when the effect catches up: an in-flight tap or resume
      // check must see that the screen is taken.
      openId.current = next.id;
      setOffer(next);
      setPhase("idle");
      setFailure(null);
      // The pop-up IS the alert on this path, so it rings through the same dedupe
      // the delayed in-app fallback uses — whichever got here first is the only
      // one that chimes, and the 2 s grace never lands mid-decision.
      alertOfferNow(next);
      void enrich(next.id);
    },
    [enrich],
  );

  /** Open for an offer we only know the id of (a push, a tap, a resume). Resolves
   *  true when the decision is on screen. `stillWanted` is asked again once the
   *  offer has arrived: the screen may have been claimed while it was in flight. */
  const openById = useCallback(
    async (id: number, stillWanted: () => boolean = () => true): Promise<boolean> => {
      if (handled.has(id)) return false;
      if (openId.current === id) return true;
      try {
        const r = await api.offer(id);
        // Anything that is not a decision belongs on the detail screen, not over the app.
        if (!isDecision(r.data)) return false;
        if (!stillWanted()) return openId.current === id;
        open(r.data);
        return true;
      } catch {
        /* gone, not ours, or offline — nothing to decide on */
        return false;
      }
    },
    [open],
  );

  const close = useCallback(() => {
    const id = openId.current;
    // Dismissed, declined or timed out: settled either way. Re-opening it on the
    // next lifecycle broadcast would be the app arguing with the driver.
    if (id !== null) handled.add(id);
    openId.current = null;
    setOffer(null);
    setPhase("idle");
    setFailure(null);
  }, []);

  // Notification taps, including one that cold-started the app. Registered for an
  // owner too, whose taps simply open the detail: they have nothing to decline.
  const lastTap = useRef(0);
  useEffect(() => {
    if (!driver) return;
    const handleTap = async ({ offerId, showDetail }: TapRequest) => {
      if (isOwner) return showDetail();
      // The pop-up already on screen for this offer IS what the driver tapped for.
      if (openId.current === offerId) return;
      // One for ANOTHER offer gives way, and counts as settled: the driver asked
      // for this one.
      if (openId.current !== null) close();
      // Only the latest tap acts: a slower answer for an earlier one must not
      // land on top of it.
      const tap = ++lastTap.current;
      const latest = () => tap === lastTap.current;
      const opened = await openById(offerId, latest);
      if (latest() && !opened) showDetail();
    };
    deliverTap = (request) => void handleTap(request);
    if (queuedTap) {
      const request = queuedTap;
      queuedTap = null;
      deliverTap(request);
    }
    return () => {
      deliverTap = null;
    };
  }, [driver, isOwner, openById, close]);

  // A driver coming BACK to the app asks once whether an offer is still waiting
  // for a decision. On an iPhone this is the normal way in: Uber holds the
  // screen, a backgrounded app runs nothing, so the broadcast that opens the
  // pop-up was never heard.
  const lastResumeCheck = useRef(0);
  const openWaiting = useCallback(async () => {
    const now = Date.now();
    if (openId.current !== null || now - lastResumeCheck.current < RESUME_CHECK_GAP_MS) return;
    lastResumeCheck.current = now;
    try {
      const pending = (await api.home()).data.pending_offer;
      if (!pending || pending.status !== "pending" || !isFreshOffer(pending)) return;
      // Never displaces a decision that got on screen meanwhile (a tap, a broadcast).
      const idle = () => openId.current === null;
      if (idle()) await openById(pending.id, idle);
    } catch {
      /* offline — Home's own reload shows what there is */
    }
  }, [openById]);

  // The live path: a `new` broadcast inlines everything the pop-up needs, so it
  // opens without a request. Anything else (a push, an older backend) resolves
  // the offer first and opens only if it is still a decision.
  useEffect(() => {
    if (!driver || isOwner) return;
    return subscribeLive((event: LiveEvent) => {
      if (event.reason === "resume") {
        void openWaiting();
        return;
      }
      const id = event.offerId;
      if (id === undefined) return;
      // The open pop-up owns the screen: an event for it is new information
      // about the decision in front of the driver, not a reason to re-open.
      if (openId.current === id) {
        void enrich(id);
        return;
      }
      if (handled.has(id)) return;
      // `status` says the lifecycle moved (accepted, geocoded, completed) — never
      // that there is something new to decide.
      if (event.offerReason === "status") return;
      if (event.offer) {
        const next = offerFromPayload(id, event.offer);
        if (isFreshOffer(next)) open(next);
        return;
      }
      void openById(id);
    });
  }, [driver, isOwner, enrich, open, openById, openWaiting]);

  const status = offer?.status ?? "pending";
  const declined = offer?.dispatch_rejected_at != null;
  const settled = phase === "sent" || phase === "failed" || declined || status !== "pending";

  // Get out of the way once there is nothing left to decide — the pop-up covers
  // the whole app, so it must never be the thing the driver has to close first.
  useEffect(() => {
    if (!offer || !settled) return;
    const id = setTimeout(close, OUTCOME_CLOSE_MS);
    return () => clearTimeout(id);
  }, [offer, settled, close]);

  // An untouched offer: the window is gone and the driver never looked. Keep it
  // a little past the deadline (the backend still accepts a late decline and
  // records Uber's answer), then close it out.
  const deadline = offer ? deadlineOf(offer.received_at, acceptWindow(offer), offer.offer_generated_at) : null;
  useEffect(() => {
    if (!offer || settled || deadline === null) return;
    const id = setTimeout(close, Math.max(0, deadline + IDLE_CLOSE_AFTER_DEADLINE_MS - Date.now()));
    return () => clearTimeout(id);
  }, [offer, settled, deadline, close]);

  if (!offer || !driver || isOwner) return null;
  return (
    <OfferPopup
      offer={offer}
      phase={phase}
      failure={failure}
      onReject={() => void reject(offer)}
      onDismiss={close}
    />
  );
}

/**
 * The pop-up itself — fully controlled, so what it shows is only ever what it
 * was handed.
 */
export function OfferPopup({
  offer,
  phase,
  failure,
  onReject,
  onDismiss,
}: {
  offer: Offer;
  phase: Phase;
  failure: string | null;
  onReject: () => void;
  onDismiss: () => void;
}) {
  const c = useColors();
  useLocale(); // re-render on a language switch
  const row = isRTL() ? "row-reverse" : "row";

  const status = offer.status ?? "pending";
  const win = acceptWindow(offer);
  const deadline = deadlineOf(offer.received_at, win, offer.offer_generated_at);
  const declined = offer.dispatch_rejected_at != null;
  // Absent means "this backend doesn't say" — ask and let the server refuse with
  // a reason the driver can read. Only an explicit `false` hides the button:
  // a tenant whose offers come from the browser extension has no live dispatch
  // session, so there is genuinely nothing to decline from.
  const canDecline = offer.can_decline !== false;
  const hasMetrics = offer.distance_m != null;
  const showReject = canDecline && !declined && status === "pending";

  return (
    <PopupSurface onDismiss={onDismiss}>
      {/* The backdrop does NOT dismiss on tap: this is a decision, not a sheet. */}
      <View style={{ flex: 1, backgroundColor: "rgba(4,5,5,0.72)", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: isDarkPalette(c) ? c.surface2 : c.surface,
            borderRadius: radius.xl,
            paddingHorizontal: 18,
            paddingTop: 12,
            paddingBottom: 18,
            gap: 14,
            ...(isDarkPalette(c) ? { borderWidth: 1, borderColor: c.line } : null),
          }}
        >
          {/* Title + the way out. The X only hides the pop-up — it is NOT a
              decline; the driver must never feel trapped by it. */}
          <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
            <SectionLabel>{t("offer.popupTitle")}</SectionLabel>
            <Pressable onPress={onDismiss} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("offer.dismiss")}>
              <X size={20} color={c.inkSubtle} />
            </Pressable>
          </View>

          {/* The fare is the hero inside the depleting ring — the one figure the
              driver judges, with the time they have to judge it drawn around it. */}
          <View style={{ alignItems: "center" }}>
            <CountdownRing deadline={deadline} windowSeconds={win} size={RING_SIZE} stroke={RING_STROKE}>
              <Text style={{ color: c.ink, fontSize: 32, fontWeight: "800", letterSpacing: -1.2, writingDirection: "ltr" }}>
                {fareLabel(offer.fare_formatted, offer.fare_amount)}
              </Text>
            </CountdownRing>
            <CountdownLabel deadline={deadline} windowSeconds={win} />
          </View>

          <RouteBlock
            pickup={cleanAddress(offer.pickup_address)}
            dropoff={cleanAddress(offer.dropoff_address)}
            pickupLabel={t("offer.abholung")}
            dropoffLabel={t("offer.ziel")}
          />

          {offer.rider_name && (
            <Text style={{ color: c.inkMuted, fontSize: 14, textAlign: isRTL() ? "right" : "left" }}>
              {offer.rider_name} · {t("offer.rider")}
            </Text>
          )}

          {/* Distance and €/km are geocoded, so they are simply not here yet on a
              fresh offer and appear in place the moment they are — the decision
              never waits for them. */}
          {hasMetrics && (
            <View style={{ flexDirection: row, gap: 18 }}>
              <Metric label={t("offer.strecke")} value={distanceLabel(offer.distance_m)} />
              <Metric label={t("offer.qualitaet")} value={perKmLabel(offer.fare_amount, offer.distance_m)} />
            </View>
          )}

          <Outcome offer={offer} phase={phase} failure={failure} />

          {showReject && (
            <PrimaryButton
              label={phase === "sending" ? t("offer.rejectSending") : t("offer.reject")}
              destructive
              loading={phase === "sending"}
              // Still tappable after the ring empties: Uber's real deadline for a
              // DISPATCH decline is not known to be the driver's 5 s, so a late
              // attempt is worth making — and the server records what Uber said.
              disabled={phase === "sent"}
              onPress={onReject}
            />
          )}
        </View>
      </View>
    </PopupSurface>
  );
}

/**
 * What the pop-up is drawn into.
 *
 * iOS cannot present a React Native `Modal` while a native modal screen is up:
 * the offer detail and Settings are both `presentation: "modal"`, and UIKit
 * silently refuses a second presentation from a controller that is already
 * presenting — so on an iPhone the decision never appeared over the very screen
 * a driver sits on after opening an offer. `FullWindowOverlay` draws into the
 * window itself, above every presented screen. Android's `Modal` is a dialog that
 * shows over anything, so Android keeps exactly what it had.
 */
function PopupSurface({ onDismiss, children }: { onDismiss: () => void; children: ReactNode }) {
  if (Platform.OS === "ios") {
    return <FullWindowOverlay unstable_accessibilityContainerViewIsModal>{children}</FullWindowOverlay>;
  }
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onDismiss}>
      {children}
    </Modal>
  );
}

/** One of the two free-once-geocoded figures. */
function Metric({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 2 }}>
      <SectionLabel>{label}</SectionLabel>
      {/* Money/distance stay LTR and Latin-digit even in Arabic. */}
      <Text style={{ color: c.ink, fontSize: 15, fontWeight: "500", writingDirection: "ltr" }}>{value}</Text>
    </View>
  );
}

/**
 * What came of it.
 *
 * The OFFER's label comes only from the backend — `dispatch_rejected_at` and
 * `status` — never from the local countdown: the backend deliberately holds an
 * offer as pending while the driver is busy, so an empty local ring says nothing
 * about whether the offer is still there. `phase` is a separate statement about
 * OUR request ("sent"), which is the one thing the app does know first-hand.
 */
function Outcome({ offer, phase, failure }: { offer: Offer; phase: Phase; failure: string | null }) {
  const c = useColors();
  const status = offer.status ?? "pending";

  if (offer.dispatch_rejected_at != null) {
    return <Line color={c.rejected} text={t("offer.rejectDeclined")} />;
  }
  if (phase === "failed") {
    return (
      <View style={{ gap: 3 }}>
        <Line color={c.danger} text={t("offer.rejectFailed")} />
        <Text style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: isRTL() ? "right" : "left" }}>
          {t("offer.rejectFailedHint")}
          {failure ? ` (${failure})` : ""}
        </Text>
      </View>
    );
  }
  if (phase === "sent") return <Line color={c.inkMuted} text={t("offer.rejectSent")} />;
  // A backend status other than pending is the offer's own news (taken, canceled).
  if (status !== "pending") {
    return (
      <View style={{ alignSelf: isRTL() ? "flex-end" : "flex-start" }}>
        <StatusBadge status={status} label={t(`status.${status}`)} />
      </View>
    );
  }
  return null;
}

function Line({ color, text }: { color: string; text: string }) {
  return (
    <Text style={{ color, fontSize: 14, fontWeight: "700", textAlign: isRTL() ? "right" : "left" }}>{text}</Text>
  );
}
