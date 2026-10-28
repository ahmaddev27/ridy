import { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, KeyRound, Trash2 } from "@/components/icons";
import { Text } from "@/components/typography";
import { PrimaryButton } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, type DriverPasskey } from "@/lib/api";
import { dateLabel } from "@/lib/format";
import { t, isRTL } from "@/lib/i18n";
import { PasskeyAlreadyRegisteredError, PasskeyCancelledError } from "@/lib/passkeys";
import { enrolPasskey } from "@/lib/passkey-enrol";
import { useColors, cardStyle } from "@/lib/theme";

/** The alias the driver (or the device) gave it, else a short id to tell rows apart. */
function passkeyName(p: DriverPasskey): string {
  return p.alias?.trim() || t("passkey.fallbackName", { id: String(p.id).slice(0, 6) });
}

export default function PasskeysScreen() {
  const c = useColors();
  const router = useRouter();
  const toast = useToast();
  const rtl = isRTL();
  const align = rtl ? "right" : "left";
  const [items, setItems] = useState<DriverPasskey[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api.passkeys()).data);
    } catch {
      setItems((cur) => cur ?? []);
      toast.show(t("passkey.loadError"), "error");
    }
  }, [toast]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (adding) return;
    setAdding(true);
    try {
      await enrolPasskey();
      toast.show(t("passkey.added"), "success");
      await load();
    } catch (e) {
      if (e instanceof PasskeyCancelledError) return;
      toast.show(t(e instanceof PasskeyAlreadyRegisteredError ? "passkey.exists" : "passkey.addError"), "error");
    } finally {
      setAdding(false);
    }
  }

  function confirmDelete(p: DriverPasskey) {
    Alert.alert(t("passkey.deleteTitle"), t("passkey.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("passkey.deleteConfirm"),
        style: "destructive",
        onPress: async () => {
          try {
            await api.deletePasskey(p.id);
            setItems((cur) => (cur ?? []).filter((x) => x.id !== p.id));
          } catch {
            toast.show(t("passkey.deleteError"), "error");
          }
        },
      },
    ]);
  }

  const Back = rtl ? ChevronRight : ChevronLeft;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <View style={{ flexDirection: rtl ? "row-reverse" : "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 6 }} accessibilityRole="button" accessibilityLabel={t("common.back")}>
          <Back size={24} color={c.ink} />
        </Pressable>
        <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700", textAlign: align }}>{t("passkey.title")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}>
        <Text style={{ color: c.inkSubtle, fontSize: 13.5, lineHeight: 19, textAlign: align }}>{t("passkey.settingsHint")}</Text>

        {items === null ? (
          <ActivityIndicator color={c.inkMuted} />
        ) : items.length === 0 ? (
          <Text style={{ color: c.inkMuted, fontSize: 14.5, textAlign: align }}>{t("passkey.empty")}</Text>
        ) : (
          <View style={cardStyle(c)}>
            {items.map((p, i) => (
              <View
                key={String(p.id)}
                style={{ flexDirection: rtl ? "row-reverse" : "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderColor: c.line }}
              >
                <KeyRound size={19} color={c.inkMuted} strokeWidth={1.6} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: c.ink, fontSize: 15, fontWeight: "500", textAlign: align }}>{passkeyName(p)}</Text>
                  <Text style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: align }}>{t("passkey.addedOn", { date: dateLabel(p.created_at) })}</Text>
                </View>
                <Pressable onPress={() => confirmDelete(p)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("passkey.delete")} style={{ padding: 6 }}>
                  <Trash2 size={18} color={c.danger} strokeWidth={1.8} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <PrimaryButton label={t("passkey.add")} onPress={() => void add()} loading={adding} icon={KeyRound} />
      </ScrollView>
    </SafeAreaView>
  );
}
