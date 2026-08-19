import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, View } from "react-native";
import { CheckCircle, AlertCircle, Info, type LucideIcon } from "lucide-react-native";
import { Text } from "@/components/typography";
import { useColors, radius } from "@/lib/theme";
import { isRTL } from "@/lib/i18n";

type ToastKind = "success" | "error" | "info";
type ToastState = { message: string; kind: ToastKind } | null;

type ToastApi = {
  show: (message: string, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastKind, LucideIcon> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

/** Lightweight themed toast rendered above the app; auto-dismisses after 2.6s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, kind: ToastKind = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, kind });
  }, []);

  useEffect(() => {
    if (!toast) return;
    Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null));
    }, 2600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast, anim]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && <ToastView toast={toast} anim={anim} />}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, anim }: { toast: NonNullable<ToastState>; anim: Animated.Value }) {
  const c = useColors();
  const tone = toast.kind === "success" ? c.accent : toast.kind === "error" ? c.danger : c.inkMuted;
  // Subtle rise: slide up a few px as it fades in.
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: 90,
        left: 16,
        right: 16,
        opacity: anim,
        transform: [{ translateY }],
        flexDirection: isRTL() ? "row-reverse" : "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: c.overlay,
        borderWidth: 1,
        borderColor: c.borderStrong,
        borderRadius: radius.control,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      {(() => { const Icon = ICONS[toast.kind]; return <Icon size={17} color={tone} strokeWidth={1.6} />; })()}
      <Text
        style={{
          flex: 1,
          color: c.ink,
          fontSize: 12.5,
          fontWeight: "500",
          textAlign: isRTL() ? "right" : "left",
        }}
      >
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
