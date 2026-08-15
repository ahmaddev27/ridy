import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ToastProvider } from "@/components/toast";
import { registerForPush } from "@/lib/push";
import { useColors } from "@/lib/theme";

export default function RootLayout() {
  return (
    <AuthProvider>
      <ToastProvider>
        <StatusBar style="auto" />
        <Gate />
      </ToastProvider>
    </AuthProvider>
  );
}

/** Routes the user between auth screens and the app based on session state, and
 *  wires push registration + notification-tap navigation once signed in. */
function Gate() {
  const { ready, driver } = useAuth();
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
    registerForPush();

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { offer_id?: string };
      if (data?.offer_id) router.push(`/offer/${data.offer_id}`);
    });
    return () => sub.remove();
  }, [driver, router]);

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
