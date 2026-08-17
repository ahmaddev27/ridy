import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ToastProvider } from "@/components/toast";
import { registerForPush } from "@/lib/push";
import { useColors } from "@/lib/theme";
import { useAppFonts } from "@/lib/fonts";
import { UpdateGate } from "@/components/update-gate";

export default function RootLayout() {
  // Load Tajawal in the background; never block the first render on it, so a
  // slow/failed font load can't leave the app on a blank white screen. Text
  // re-renders with the font once it's ready.
  useAppFonts();

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

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === "login" || segments[0] === "activate";
    if (!driver && !inAuth) {
      router.replace("/login");
    } else if (driver && inAuth) {
      router.replace("/");
    }
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

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: c.canvas, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.ink} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="activate" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="offer/[id]" options={{ presentation: "modal" }} />
    </Stack>
  );
}
