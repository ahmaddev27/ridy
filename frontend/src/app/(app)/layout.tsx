import { AuthProvider } from "@/components/auth/auth-provider";
import { AppGuard } from "@/components/auth/app-guard";
import { AppShell } from "@/components/layout/app-shell";
import { OfferAlerts } from "@/components/offer-alerts";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { ClientErrorReporter } from "@/components/client-error-reporter";
import { AppFeedsProvider } from "@/components/layout/app-feeds";
import { WidgetBoundary } from "@/components/widget-boundary";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <AppGuard>
        <AppFeedsProvider>
          <ClientErrorReporter />
          {/* Own boundary: an alert render bug must never take the shell down. */}
          <WidgetBoundary silent>
            <OfferAlerts />
          </WidgetBoundary>
          <OnboardingTour />
          <AppShell>{children}</AppShell>
        </AppFeedsProvider>
      </AppGuard>
    </AuthProvider>
  );
}
