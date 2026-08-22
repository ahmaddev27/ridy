import { useEffect, useState, useRef } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ToastProvider } from "@/components/toast";
import { Linking } from "react-native";
import { registerForPush, registerOfferCategory, OPEN_MAP_ACTION } from "@/lib/push";
import { useColors, setThemeMode, type ThemeMode } from "@/lib/theme";
import { useAppFonts } from "@/lib/fonts";
import { setLocale } from "@/lib/i18n";
import { UpdateGate } from "@/components/update-gate";
import { OfflineScreen } from "@/components/offline-screen";
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

function RootLayout() {
  const fontsReady = useAppFonts();
  const [timedOut, setTimedOut] = useState(false);
  // Apply the saved language BEFORE the first paint, so the splash caption (and
  // every screen) starts in the chosen language, not the device default.
  const [localeReady, setLocaleReady] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), FONT_TIMEOUT_MS);
    // Apply the saved appearance (light/dark/system) too — a frame-early flash is
    // fine; it doesn't gate the first paint.
    SecureStore.getItemAsync("theme")
      .then((m) => { if (m === "light" || m === "dark" || m === "system") setThemeMode(m as ThemeMode); })
      .catch(() => {});
    SecureStore.getItemAsync("locale")
      .then((l) => { if (l) setLocale(l); })
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
          <StatusBar style="auto" />
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

/** Opens the maps app at the pickup → drop-off route. Falls back to a plain
 *  search when only one address is present, and no-ops when neither is. */
function openRouteInMaps(pickup?: string, dropoff?: string): void {
  const origin = (pickup ?? "").trim();
  const dest = (dropoff ?? "").trim();

  let url: string | null = null;
  if (origin && dest) {
    url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=driving`;
  } else if (origin || dest) {
    url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(origin || dest)}`;
  }

  if (url) Linking.openURL(url).catch(() => {});
}

/** Routes the user between auth screens and the app based on session state, and
 *  wires push registration + notification-tap navigation once signed in. */
function Gate() {
  const { ready, driver, isOwner, offline, retry } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const c = useColors();

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
    const seg = segments[0];
    if (seg === "splash" || seg === "language" || seg === "onboarding") return;
    const inAuth = seg === "login" || seg === "activate";
    if (!driver && !inAuth) router.replace("/login");
    else if (driver && inAuth) router.replace("/");
  }, [ready, driver, offline, segments, router]);

  // A stored session we couldn't restore because the server is unreachable:
  // show "check your connection" instead of logging the user out.
  if (ready && offline && !driver) {
    return <OfflineScreen onRetry={retry} />;
  }

  // Once signed in: register for push and open the offer when a notification is tapped.
  useEffect(() => {
    if (!driver) return;
    // Both roles register for push. An owner registers on their User token via the
    // fleet endpoint (the driver /devices endpoint would 401 their token) and then
    // receives a copy of every one of their drivers' offers; a driver registers
    // against themselves. Both open the tapped offer (owner mode renders it read-only).
    registerForPush(isOwner);
    registerOfferCategory();

    // De-dupe: a cold-start tap is delivered by BOTH getLastNotificationResponse
    // and (sometimes) the listener, so handle each notification only once.
    const handled = new Set<string>();
    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (id) {
        if (handled.has(id)) return;
        handled.add(id);
      }
      const data = response.notification.request.content.data as {
        offer_id?: string;
        pickup?: string;
        dropoff?: string;
      };

      // "Open in map" action button: open the route without opening the app.
      if (response.actionIdentifier === OPEN_MAP_ACTION) {
        openRouteInMaps(data?.pickup, data?.dropoff);
        return;
      }

      // Default tap: only navigate for a numeric offer id — the payload is
      // attacker-influenced, so never interpolate an arbitrary string into the route.
      if (data?.offer_id && /^\d+$/.test(String(data.offer_id))) router.push(`/offer/${data.offer_id}`);
    };

    // Cold start: the notification tap that LAUNCHED the app is not delivered to
    // the listener below, so pick it up explicitly — this is what makes a tap open
    // the offer instead of the home screen when the app was closed.
    Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});

    // Warm taps (app already running / backgrounded).
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [driver, isOwner, router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="activate" />
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      <Stack.Screen name="language" />
      <Stack.Screen name="splash" options={{ gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="offer/[id]" options={{ presentation: "modal" }} />
      <Stack.Screen name="settings" options={{ presentation: "modal" }} />
    </Stack>
  );
}
