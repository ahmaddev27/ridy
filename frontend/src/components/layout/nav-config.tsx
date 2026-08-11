import {
  LayoutDashboard,
  Bell,
  Users,
  Radio,
  Plug,
  Car,
  Building2,
  Settings,
  Mail,
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
      { href: "/vehicles", label: "nav.vehicles", icon: Car },
      { href: "/connections", label: "nav.connections", icon: Plug },
    ],
  },

  // ── Super-admin surface (hidden from company managers) ─────────────────────
  {
    title: "navGroups.admin",
    requiresRole: "super_admin",
    items: [
      { href: "/admin", label: "nav.adminDashboard", icon: LayoutDashboard },
      { href: "/admin/companies", label: "nav.companies", icon: Building2 },
      { href: "/admin/proxies", label: "nav.proxies", icon: Plug },
      { href: "/admin/email-templates", label: "nav.emailTemplates", icon: Mail },
      { href: "/admin/settings", label: "nav.settings", icon: Settings },
    ],
  },

  // ── Everyone ───────────────────────────────────────────────────────────────
  {
    title: "navGroups.account",
    items: [{ href: "/profile", label: "nav.profile", icon: UserCircle }],
  },
];
