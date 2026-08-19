import { useEffect, useState, useRef } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ToastProvider } from "@/components/toast";
import { registerForPush } from "@/lib/push";
import { useColors } from "@/lib/theme";
import { useAppFonts } from "@/lib/fonts";
import { setLocale } from "@/lib/i18n";
import { UpdateGate } from "@/components/update-gate";

// Hold the native splash screen up until the fonts are registered, so the very
// first painted frame already has Tajawal. Without this Arabic falls back to the
// system font on first paint (and doesn't reliably recover in a release build).
// Icons are SVG (lucide-react-native), so they need no font to be ready.
SplashScreen.preventAutoHideAsync().catch(() => {});

/** Fonts must be ready before the first paint, but a failed/slow load must never
 *  hang on the splash forever — fall through after this budget with the system
 *  font (text stays readable, icons re-register once loaded). */
const FONT_TIMEOUT_MS = 4000;

export default function RootLayout() {
  const fontsReady = useAppFonts();
  const [timedOut, setTimedOut] = useState(false);
  // Apply the saved language BEFORE the first paint, so the splash caption (and
  // every screen) starts in the chosen language, not the device default.
  const [localeReady, setLocaleReady] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), FONT_TIMEOUT_MS);
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

/** Routes the user between auth screens and the app based on session state, and
 *  wires push registration + notification-tap navigation once signed in. */
function Gate() {
  const { ready, driver, isOwner } = useAuth();
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
    if (seg !== "splash" && seg !== "language") router.replace("/splash");
  }, [segments, router]);

  // Auth gate — only once the session is known. Onboarding screens self-navigate.
  useEffect(() => {
    if (!ready) return;
    const seg = segments[0];
    if (seg === "splash" || seg === "language") return;
    const inAuth = seg === "login" || seg === "activate";
    if (!driver && !inAuth) router.replace("/login");
    else if (driver && inAuth) router.replace("/");
  }, [ready, driver, segments, router]);

  // Once signed in: register for push and open the offer when a notification is tapped.
  useEffect(() => {
    if (!driver) return;
    // Owners are read-only fleet monitors on a User token; the /driver/devices
    // endpoint (auth:driver guard) rejects it with 401, which would nuke the
    // session and bounce them back to login. They don't receive driver push.
    if (!isOwner) registerForPush();

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { offer_id?: string };
      // Only navigate for a numeric offer id — the payload is attacker-influenced,
      // so never interpolate an arbitrary string into the route.
      if (data?.offer_id && /^\d+$/.test(data.offer_id)) router.push(`/offer/${data.offer_id}`);
    });
    return () => sub.remove();
  }, [driver, isOwner, router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="activate" />
      <Stack.Screen name="language" />
      <Stack.Screen name="splash" options={{ gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="offer/[id]" options={{ presentation: "modal" }} />
      <Stack.Screen name="settings" options={{ presentation: "modal" }} />
    </Stack>
  );
}
