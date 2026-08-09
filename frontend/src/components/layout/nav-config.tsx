import {
  LayoutDashboard,
  Bell,
  Users,
  Radio,
  Link2,
  Plug,
  ScrollText,
  Palette,
  Building2,
  Settings,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

/** `title`/`label` are i18n keys resolved in the Sidebar via useI18n(). */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
};

/**
 * `requiresRole` shows the group only to users with that role.
 * `hideForRole` hides it from users with that role.
 * Together they give a clean split: company groups are hidden from the
 * super-admin, and admin groups are hidden from company managers.
 */
export type NavGroup = { title: string; items: NavItem[]; requiresRole?: string; hideForRole?: string };

export const navGroups: NavGroup[] = [
  // ── Company manager surface (hidden from the super-admin) ──────────────────
  {
    title: "navGroups.overview",
    hideForRole: "super_admin",
    items: [
      { href: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard },
      { href: "/offers", label: "nav.offers", icon: Radio },
      { href: "/notifications", label: "nav.notifications", icon: Bell },
    ],
  },
  {
    title: "navGroups.fleet",
    hideForRole: "super_admin",
    items: [
      { href: "/drivers", label: "nav.drivers", icon: Users },
      { href: "/driver-linking", label: "nav.driverLinking", icon: Link2 },
      { href: "/connections", label: "nav.connections", icon: Plug },
    ],
  },
  {
    title: "navGroups.governance",
    hideForRole: "super_admin",
    items: [{ href: "/audit-log", label: "nav.auditLog", icon: ScrollText }],
  },

  // ── Super-admin surface (hidden from company managers) ─────────────────────
  {
    title: "navGroups.admin",
    requiresRole: "super_admin",
    items: [
      { href: "/admin", label: "nav.adminDashboard", icon: LayoutDashboard },
      { href: "/admin/companies", label: "nav.companies", icon: Building2 },
      { href: "/admin/settings", label: "nav.settings", icon: Settings },
    ],
  },

  // ── Everyone ───────────────────────────────────────────────────────────────
  {
    title: "navGroups.account",
    items: [{ href: "/profile", label: "nav.profile", icon: UserCircle }],
  },
  {
    title: "navGroups.system",
    requiresRole: "super_admin",
    items: [{ href: "/design-system", label: "nav.designSystem", icon: Palette }],
  },
];
