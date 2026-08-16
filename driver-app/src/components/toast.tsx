import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/typography";
import { useColors, radius } from "@/lib/theme";
import { isRTL } from "@/lib/i18n";

type ToastKind = "success" | "error" | "info";
type ToastState = { message: string; kind: ToastKind } | null;

type ToastApi = {
  show: (message: string, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastKind, keyof typeof Ionicons.glyphMap> = {
  success: "checkmark-circle",
  error: "alert-circle",
  info: "information-circle",
};

/** Lightweight themed toast rendered above the app; auto-dismisses after 2.6s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, kind: ToastKind = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, kind });
  }, []);

  useEffect(() => {
    if (!toast) return;
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null));
    }, 2600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast, opacity]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && <ToastView toast={toast} opacity={opacity} />}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, opacity }: { toast: NonNullable<ToastState>; opacity: Animated.Value }) {
  const c = useColors();
  const tone = toast.kind === "success" ? c.completed : toast.kind === "error" ? c.danger : c.accent;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: 90,
        left: 16,
        right: 16,
        opacity,
        flexDirection: isRTL() ? "row-reverse" : "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: radius.lg,
        paddingHorizontal: 16,
        paddingVertical: 14,
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    >
      <Ionicons name={ICONS[toast.kind]} size={20} color={tone} />
      <Text style={{ flex: 1, color: c.ink, fontWeight: "600", textAlign: isRTL() ? "right" : "left" }}>
        {toast.message}
      </Text>
    </Animated.View>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
