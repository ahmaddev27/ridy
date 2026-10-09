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
  Banknote,
  MapPin,
  FileBarChart,
  UserCog,
  UserX,
  Ticket,
  ReceiptText,
  FileSpreadsheet,
  FileText,
  Activity,
  Megaphone,
  Inbox,
  type LucideIcon,
} from "lucide-react";

/** `title`/`label` are i18n keys resolved in the Sidebar via useI18n(). */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  /**
   * Show the item only while the PLATFORM has opened the El-Professor link for
   * this company. Until now the nav gated on roles alone, and a role cannot
   * express this: every fleet manager has the same role whether or not the
   * operator opened their company.
   *
   * It hides a page; it does not protect one. Every El-Professor route is
   * behind `elprofessor.enabled` on the server, which is the wall.
   */
  requiresElProfessor?: boolean;
};

/**
 * `requiresRole` shows the group only to users with that role.
 * `hideForRole` hides it from users with that role.
 * Together they give a clean split: company groups are hidden from the
 * super-admin, and admin groups are hidden from company managers.
 */
export type NavGroup = { title: string; items: NavItem[]; requiresRole?: string; hideForRole?: string | string[] };

export const navGroups: NavGroup[] = [
  // ── Reseller surface (only resellers) ──────────────────────────────────────
  {
    title: "navGroups.reseller",
    requiresRole: "reseller",
    items: [{ href: "/reseller", label: "nav.generateCode", icon: Ticket }],
  },

  // ── Company manager surface (hidden from super-admin + resellers) ──────────
  {
    title: "navGroups.overview",
    hideForRole: ["super_admin", "reseller"],
    items: [
      { href: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard },
      { href: "/offers", label: "nav.offers", icon: Radio },
      { href: "/notifications", label: "nav.notifications", icon: Bell },
    ],
  },
  {
    title: "navGroups.fleet",
    hideForRole: ["super_admin", "reseller"],
    items: [
      { href: "/drivers", label: "nav.drivers", icon: Users },
      { href: "/vehicles", label: "nav.vehicles", icon: Car },
      { href: "/map", label: "nav.map", icon: MapPin },
      { href: "/connections", label: "nav.connections", icon: Plug },
      // Its own page, deliberately not inside Connections: that screen is the
      // Uber link, and a company reading "Connections" should not have to tell
      // two unrelated integrations apart inside one page.
      { href: "/elprofessor", label: "nav.elprofessor", icon: FileSpreadsheet, requiresElProfessor: true },
      { href: "/subscription", label: "nav.mySubscription", icon: ReceiptText },
    ],
  },

  // ── Super-admin surface (hidden from company managers), split into sections ──
  {
    title: "navGroups.overview",
    requiresRole: "super_admin",
    items: [{ href: "/admin", label: "nav.adminDashboard", icon: LayoutDashboard }],
  },
  {
    title: "navGroups.customers",
    requiresRole: "super_admin",
    items: [
      { href: "/admin/companies", label: "nav.companies", icon: Building2 },
      { href: "/admin/users", label: "nav.users", icon: UserCog },
      { href: "/admin/drivers", label: "nav.driverDirectory", icon: Users },
      { href: "/admin/orphan-drivers", label: "nav.orphanDrivers", icon: UserX },
      { href: "/admin/collectors", label: "nav.collectors", icon: Banknote },
    ],
  },
  {
    title: "navGroups.billing",
    requiresRole: "super_admin",
    items: [
      { href: "/admin/reports", label: "nav.subscriptions", icon: FileBarChart },
      { href: "/admin/payment-requests", label: "nav.paymentRequests", icon: ReceiptText },
      { href: "/admin/invoice-template", label: "nav.invoiceTemplate", icon: FileText },
    ],
  },
  {
    title: "navGroups.system",
    requiresRole: "super_admin",
    items: [
      { href: "/admin/system-health", label: "nav.systemHealth", icon: Activity },
      { href: "/admin/ads", label: "nav.ads", icon: Megaphone },
      { href: "/admin/inbox", label: "nav.inbox", icon: Inbox },
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
