/**
 * The ONLY place the app imports lucide icons from.
 *
 * Importing the "lucide-react-native" barrel pulls all ~1,770 icons into the
 * bundle and evaluates them at startup; importing each icon from its own file
 * ships just the ~40 we use. Add new icons here (file names are kebab-case in
 * node_modules/lucide-react-native/dist/esm/icons/) and never import the barrel
 * elsewhere — only its types, with `import type`.
 */
export type { LucideIcon, LucideProps } from "lucide-react-native";

export { default as AlertCircle } from "lucide-react-native/icons/circle-alert";
export { default as BarChart3 } from "lucide-react-native/icons/chart-column";
export { default as BatteryWarning } from "lucide-react-native/icons/battery-warning";
export { default as Bell } from "lucide-react-native/icons/bell";
export { default as BellOff } from "lucide-react-native/icons/bell-off";
export { default as Calendar } from "lucide-react-native/icons/calendar";
export { default as Car } from "lucide-react-native/icons/car";
export { default as Check } from "lucide-react-native/icons/check";
export { default as CheckCircle } from "lucide-react-native/icons/circle-check";
export { default as ChevronDown } from "lucide-react-native/icons/chevron-down";
export { default as ChevronLeft } from "lucide-react-native/icons/chevron-left";
export { default as ChevronRight } from "lucide-react-native/icons/chevron-right";
export { default as Clock } from "lucide-react-native/icons/clock";
export { default as Eye } from "lucide-react-native/icons/eye";
export { default as EyeOff } from "lucide-react-native/icons/eye-off";
export { default as FileText } from "lucide-react-native/icons/file-text";
export { default as Gauge } from "lucide-react-native/icons/gauge";
export { default as Globe } from "lucide-react-native/icons/globe";
export { default as Home } from "lucide-react-native/icons/house";
export { default as Info } from "lucide-react-native/icons/info";
export { default as LifeBuoy } from "lucide-react-native/icons/life-buoy";
export { default as LogIn } from "lucide-react-native/icons/log-in";
export { default as LogOut } from "lucide-react-native/icons/log-out";
export { default as Mail } from "lucide-react-native/icons/mail";
export { default as Map } from "lucide-react-native/icons/map";
export { default as MessageCircle } from "lucide-react-native/icons/message-circle";
export { default as Package } from "lucide-react-native/icons/package";
export { default as Radio } from "lucide-react-native/icons/radio";
export { default as Route } from "lucide-react-native/icons/route";
export { default as Search } from "lucide-react-native/icons/search";
export { default as Settings } from "lucide-react-native/icons/settings";
export { default as ShieldCheck } from "lucide-react-native/icons/shield-check";
export { default as SlidersHorizontal } from "lucide-react-native/icons/sliders-horizontal";
export { default as Trash2 } from "lucide-react-native/icons/trash-2";
export { default as User } from "lucide-react-native/icons/user";
export { default as UserCircle } from "lucide-react-native/icons/circle-user";
export { default as Vibrate } from "lucide-react-native/icons/vibrate";
export { default as Volume2 } from "lucide-react-native/icons/volume-2";
export { default as WifiOff } from "lucide-react-native/icons/wifi-off";
