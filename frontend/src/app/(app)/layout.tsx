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
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="flex-1 p-6">{children}</main>
          </div>
        </div>
      </AppGuard>
    </AuthProvider>
  );
}
