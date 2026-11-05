import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, AppState, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useFocusEffect } from "expo-router";
import { Text } from "@/components/typography";
import { LoadErrorBanner } from "@/components/status-banner";
import { api } from "@/lib/api";
import { t, isRTL, useLocale } from "@/lib/i18n";
import { useColors, isDarkPalette } from "@/lib/theme";
import { PRESENCE_COLOR, buildMapHtml, setMarkersScript, toMarkers, type MapMarker, type Presence } from "@/lib/live-map-html";

const POLL_MS = 13_000;
const LEGEND: { key: Presence; label: string }[] = [
  { key: "online", label: "liveMap.online" },
  { key: "en_route", label: "liveMap.enRoute" },
  { key: "on_trip", label: "liveMap.onTrip" },
];

/** Manager-only: the company's live driver positions on a free OSM/Leaflet map. */
export default function LiveMapScreen() {
  const c = useColors();
  useLocale();
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [focused, setFocused] = useState(false);
  const dark = isDarkPalette(c);
  // Rebuilt only on theme change: a new `source` reloads the page.
  const html = useMemo(() => buildMapHtml(dark), [dark]);

  const load = useCallback(async () => {
    try {
      const res = await api.managerLiveDrivers();
      setMarkers(toMarkers(res.data));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  // Poll only while the tab is focused and the app is in the foreground.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      load();
      const timer = setInterval(() => AppState.currentState === "active" && load(), POLL_MS);
      return () => {
        clearInterval(timer);
        setFocused(false);
      };
    }, [load]),
  );

  useEffect(() => {
    if (ready) webRef.current?.injectJavaScript(setMarkersScript(markers));
  }, [ready, markers]);

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700" }}>{t("liveMap.title")}</Text>
        <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("liveMap.count", { n: String(markers.length) })}</Text>
      </View>
      {loadError ? <LoadErrorBanner onRetry={load} /> : null}
      <View style={{ flex: 1 }}>
        {focused ? (
          <WebView
            key={dark ? "dark" : "light"}
            ref={webRef}
            originWhitelist={["*"]}
            source={{ html, baseUrl: "https://reidey.de" }}
            onLoadEnd={() => setReady(true)}
            onLoadStart={() => setReady(false)}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => <ActivityIndicator style={{ position: "absolute", top: "50%", alignSelf: "center" }} color={c.accent} />}
            style={{ backgroundColor: c.canvas }}
          />
        ) : null}
        {ready && markers.length === 0 && !loadError ? (
          <View pointerEvents="none" style={{ position: "absolute", top: 12, alignSelf: "center", backgroundColor: c.surface, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 }}>
            <Text style={{ color: c.inkMuted, fontSize: 12 }}>{t("liveMap.empty")}</Text>
          </View>
        ) : null}
        <View style={{ position: "absolute", bottom: 12, left: 12, right: 12, flexDirection: isRTL() ? "row-reverse" : "row", flexWrap: "wrap", gap: 12, backgroundColor: c.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
          {LEGEND.map((l) => (
            <View key={l.key} style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: PRESENCE_COLOR[l.key] }} />
              <Text style={{ color: c.inkMuted, fontSize: 11 }}>{t(l.label)}</Text>
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}
