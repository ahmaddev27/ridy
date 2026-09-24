import { useCallback, useEffect, useRef, useState } from "react";
import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { ToastProvider } from "@/components/toast";
import { registerOfferCategory, startPushRegistration, OPEN_MAP_ACTION } from "@/lib/push";
import { markAlerted } from "@/lib/offer-alert";
import { isMultiStop } from "@/lib/notification-channels";
import { startLive, stopLive } from "@/lib/live";
import { openRouteInMaps } from "@/lib/maps";
import { useColors, isDarkPalette, setThemeMode, type ThemeMode } from "@/lib/theme";
import { useAppFonts } from "@/lib/fonts";
import { setLocale } from "@/lib/i18n";
import { ensureFreshInstall } from "@/lib/install-guard";
import { useOtaUpdates } from "@/lib/ota";
import { UpdateGate } from "@/components/update-gate";
import { OfflineScreen } from "@/components/offline-screen";
import { SuspendedScreen } from "@/components/suspended-screen";
import { initSentry, Sentry } from "@/lib/sentry";

// Start crash/error reporting as early as possible (inert without a DSN).
initSentry();

// Hold the native splash screen up until the fonts are registered, so the very
// first painted frame already has Tajawal. Without this Arabic falls back to the
// system font on first paint (and doesn't reliably recover in a release build).
// Icons are SVG (lucide-react-native), so they need no font to be ready.
SplashScreen.preventAutoHideAsync().catch(() => {});

/** Fonts must be ready before the first paint, but a failed/slow load must never
 *  hang on the splash forever — fall through after this budget with the system
 *  font (text stays readable, icons re-register once loaded). */
const FONT_TIMEOUT_MS = 4000;

/** Status bar icons that stay readable in the IN-APP theme (not the OS one). */
function ThemedStatusBar() {
  const c = useColors();
  return <StatusBar style={isDarkPalette(c) ? "light" : "dark"} />;
}

function RootLayout() {
  const fontsReady = useAppFonts();
  const [timedOut, setTimedOut] = useState(false);
  // Apply the saved language BEFORE the first paint, so the splash caption (and
  // every screen) starts in the chosen language, not the device default.
  const [localeReady, setLocaleReady] = useState(false);
  useOtaUpdates();

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), FONT_TIMEOUT_MS);
    // The reinstall guard must run BEFORE reading the saved language/theme:
    // otherwise a reinstalled iPhone would skip onboarding with stale Keychain data.
    ensureFreshInstall()
      .then(() => {
        // Apply the saved appearance (light/dark/system) — a frame-early flash is
        // fine; it doesn't gate the first paint.
        SecureStore.getItemAsync("theme")
          .then((m) => { if (m === "light" || m === "dark" || m === "system") setThemeMode(m as ThemeMode); })
          .catch(() => {});
        return SecureStore.getItemAsync("locale").then((l) => { if (l) setLocale(l); });
      })
      .catch(() => {})
      .finally(() => setLocaleReady(true));
    return () => clearTimeout(id);
  }, []);

  const ready = (fontsReady || timedOut) && localeReady;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Keep the native splash visible (return nothing) until fonts are ready.
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ToastProvider>
          <ThemedStatusBar />
          <UpdateGate>
            <Gate />
          </UpdateGate>
        </ToastProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

// Wrap the root so Sentry can capture render errors + attach touch/nav context
// (a no-op passthrough when Sentry was not initialized).
export default Sentry.wrap(RootLayout);

/**
 * Parse the notification's `data.stops` JSON string into the route's ordered
 * stops (pickup first, then each drop-off) so "Open in map" can route through the
 * whole multi-stop trip. The payload is attacker-influenced, so any parse or shape
 * failure falls back to `undefined` — a plain pickup → drop-off route.
 */
function parseStops(raw?: string): { address: string | null; lat?: number | null; lng?: number | null }[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .filter((s): s is { address?: unknown; lat?: unknown; lng?: unknown } => !!s && typeof s === "object")
      .map((s) => ({
        address: typeof s.address === "string" ? s.address : null,
        lat: typeof s.lat === "number" ? s.lat : null,
        lng: typeof s.lng === "number" ? s.lng : null,
      }));
  } catch {
    return undefined;
  }
}

/** Parse an FCM string data value ("51.24") into a number, or null when absent/NaN. */
function numOrNull(value?: string): number | null {
  const n = value != null && value !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

type OfferPushData = {
  offer_id?: string;
  pickup?: string;
  dropoff?: string;
  pickup_lat?: string;
  pickup_lng?: string;
  dropoff_lat?: string;
  dropoff_lng?: string;
  geo_source?: string;
  stops?: string;
  stops_count?: string;
  /** "1" on the in-app fallback notification (never on an FCM push). */
  local?: string;
};

/** Notification taps already acted on in this process (survives re-renders). */
const handledResponses = new Set<string>();
/** The tap that launched the app is read once per process, never replayed. */
let coldStartChecked = false;

/** Screens a queued offer must not be pushed on top of. */
const PRE_APP_SEGMENTS = new Set(["splash", "onboarding", "language", "login"]);

/** Routes the user between auth screens and the app based on session state, and
 *  wires push registration + notification-tap navigation once signed in. */
function Gate() {
  const { ready, driver, isOwner, offline, suspended, clearSuspended, retry } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const navState = useRootNavigationState();
  const c = useColors();
  const driverId = driver?.id ?? null;

  // Cold start: jump straight to the brand splash (once), independent of auth
  // readiness — the splash IS the loading screen, so no separate spinner shows.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const seg = segments[0];
    if (seg !== "splash" && seg !== "language" && seg !== "onboarding") router.replace("/splash");
  }, [segments, router]);

  // Auth gate — only once the session is known. Onboarding screens self-navigate.
  useEffect(() => {
    if (!ready) return;
    // Offline with a stored session: don't bounce to login — the offline screen
    // (rendered below) keeps the session and offers a retry.
    if (offline && !driver) return;
    // The suspension screen replaces the navigator — nothing to route yet.
    if (suspended && !driver) return;
    const seg = segments[0];
    if (seg === "splash" || seg === "language" || seg === "onboarding") return;
    const inAuth = seg === "login";
    if (!driver && !inAuth) router.replace("/login");
    else if (driver && inAuth) router.replace("/");
  }, [ready, driver, offline, suspended, segments, router]);

  // Once signed in: register for push (with retry + token rotation) and open the
  // one realtime socket for the session. Keyed on the IDENTITY, not the profile
  // object — saving the name in Settings must not re-register anything.
  useEffect(() => {
    if (driverId == null) return;
    const stopPush = startPushRegistration(isOwner);
    void registerOfferCategory();
    // Owners have no driver channel; they rely on push + polling.
    startLive(isOwner ? null : driverId, api.getToken());
    return () => {
      stopPush();
      stopLive();
    };
  }, [driverId, isOwner]);

  // Notification taps. Registered once, independent of auth: "Open in map" needs
  // only the payload, and an offer tap is queued until the app can show it.
  const pendingOffer = useRef<string | null>(null);
  const [pendingTick, setPendingTick] = useState(0);
  const handleResponse = useCallback((response: Notifications.NotificationResponse | null) => {
    if (!response) return;
    const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
    if (handledResponses.has(key)) return;
    handledResponses.add(key);
    // Never replay this tap on a later read (re-login, JS reload).
    try {
      Notifications.clearLastNotificationResponse();
    } catch {
      /* unsupported on this platform */
    }

    const data = (response.notification.request.content.data ?? {}) as OfferPushData;
    // A push tapped from the tray (background / cold start) never passed through
    // the foreground handler: record it so the resume reload's in-app fallback
    // doesn't ring the same offer a second time.
    if (data.offer_id != null && data.local !== "1") {
      markAlerted(data.offer_id, isMultiStop(data.stops_count));
    }
    // "Open in map" action button: route through every stop of a multi-stop trip
    // (Google Maps waypoints). Prefer Uber's exact coordinates so a
    // house-number-less address still pins right.
    if (response.actionIdentifier === OPEN_MAP_ACTION) {
      openRouteInMaps({
        pickup: data.pickup,
        dropoff: data.dropoff,
        pickupPoint: { lat: numOrNull(data.pickup_lat), lng: numOrNull(data.pickup_lng) },
        dropoffPoint: { lat: numOrNull(data.dropoff_lat), lng: numOrNull(data.dropoff_lng) },
        stops: parseStops(data.stops),
        exact: data.geo_source === "uber",
      });
      return;
    }
    // Default tap: only a numeric offer id — the payload is attacker-influenced,
    // so never interpolate an arbitrary string into the route.
    if (data.offer_id && /^\d+$/.test(String(data.offer_id))) {
      pendingOffer.current = String(data.offer_id);
      setPendingTick((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    // Cold start: the tap that LAUNCHED the app is not delivered to the listener.
    if (!coldStartChecked) {
      coldStartChecked = true;
      Notifications.getLastNotificationResponseAsync().then(handleResponse).catch(() => {});
    }
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => sub.remove();
  }, [handleResponse]);

  // Open a queued offer as soon as it can sit on top of Home: signed in, the
  // navigator mounted, and the splash/onboarding already handed off — so the
  // splash's replace('/') can never wipe it out, whatever the network speed.
  useEffect(() => {
    const id = pendingOffer.current;
    if (!id || !driver || !navState?.key) return;
    const seg = segments[0];
    if (!seg || PRE_APP_SEGMENTS.has(seg)) return;
    pendingOffer.current = null;
    router.push(`/offer/${id}`);
  }, [driver, segments, router, navState?.key, pendingTick]);

  // A suspended company: explain it instead of "no internet" / "invalid code".
  // These early returns sit AFTER every hook — returning before them renders
  // fewer hooks and crashes reconciliation.
  if (suspended && !driver) {
    return <SuspendedScreen info={suspended} onBack={clearSuspended} />;
  }

  // A stored session we couldn't restore because the server is unreachable:
  // show "check your connection" instead of logging the user out.
  if (ready && offline && !driver) {
    return <OfflineScreen onRetry={retry} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      <Stack.Screen name="language" />
      <Stack.Screen name="splash" options={{ gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="offer/[id]" options={{ presentation: "modal" }} />
      <Stack.Screen name="settings" options={{ presentation: "modal" }} />
    </Stack>
  );
}
