import {
  LayoutDashboard,
  Bell,
  Users,
  Radio,
  Link2,
  Plug,
  ScrollText,
  Palette,
  type LucideIcon,
} from "lucide-react";

/** `title`/`label` are i18n keys resolved in the Sidebar via useI18n(). */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
};

export type NavGroup = { title: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    title: "navGroups.overview",
    items: [
      { href: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard },
      { href: "/offers", label: "nav.offers", icon: Radio },
      { href: "/notifications", label: "nav.notifications", icon: Bell },
    ],
  },
  {
    title: "navGroups.fleet",
    items: [
      { href: "/drivers", label: "nav.drivers", icon: Users },
      { href: "/driver-linking", label: "nav.driverLinking", icon: Link2 },
      { href: "/connections", label: "nav.connections", icon: Plug },
    ],
  },
  {
    title: "navGroups.governance",
    items: [{ href: "/audit-log", label: "nav.auditLog", icon: ScrollText }],
  },
  {
    title: "navGroups.system",
    items: [{ href: "/design-system", label: "nav.designSystem", icon: Palette }],
  },
];
