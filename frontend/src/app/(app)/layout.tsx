import { AuthProvider } from "@/components/auth/auth-provider";
import { AppGuard } from "@/components/auth/app-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { OfferAlerts } from "@/components/offer-alerts";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <AppGuard>
        <OfferAlerts />
        {/* Fixed-height shell: the sidebar and topbar stay put; only the main
            content scrolls, so the sidebar never scrolls away or leaves white. */}
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      </AppGuard>
    </AuthProvider>
  );
}
