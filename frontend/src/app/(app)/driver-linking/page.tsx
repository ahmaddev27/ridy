"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Link2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listUnlinkedDrivers, linkDriver, type UnlinkedDriver } from "@/lib/api/linking";
import { listDrivers } from "@/lib/api/drivers";

export default function DriverLinkingPage() {
  const { t } = useI18n();
  const unlinked = useAsync(listUnlinkedDrivers);
  const drivers = useAsync(listDrivers);
  const [active, setActive] = useState<UnlinkedDriver | null>(null);
  const [driverId, setDriverId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const rows = unlinked.data ?? [];
  const driverOptions = (drivers.data ?? []).filter((d) => !d.uber_linked);

  async function submit() {
    if (!active || !driverId) return;
    setBusy(true);
    try {
      const result = await linkDriver(Number(driverId), active.uber_driver_uuid);
      toast.success(t("screens.driverLinking.linkedToast"), {
        description: t("screens.driverLinking.linkedToastDesc").replace(
          "{count}",
          String(result.backfilled_offers),
        ),
      });
      setActive(null);
      setDriverId("");
      await Promise.all([unlinked.refetch(), drivers.refetch()]);
    } catch (e) {
      toast.error(t("screens.driverLinking.linkFailed"), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("screens.driverLinking.title")}
        subtitle={t("screens.driverLinking.subtitle")}
      />

      <Card className="overflow-hidden">
        {unlinked.loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Link2}
            title={t("screens.driverLinking.empty")}
            description={t("screens.driverLinking.emptyDesc")}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-start text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("screens.driverLinking.colDriver")}</th>
                <th className="px-4 py-3 font-semibold">{t("screens.driverLinking.colUuid")}</th>
                <th className="px-4 py-3 font-semibold">{t("screens.driverLinking.colOffers")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.uber_driver_uuid} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.name ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.uber_driver_uuid}</td>
                  <td className="px-4 py-3">
                    <Badge status="neutral">{r.offers}</Badge>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Button
                      variant="primary"
                      onClick={() => {
                        setDriverId("");
                        setActive(r);
                      }}
                    >
                      <Link2 className="h-4 w-4" /> {t("screens.driverLinking.link")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        title={t("screens.driverLinking.modalTitle")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setActive(null)}>
              {t("screens.driverLinking.cancel")}
            </Button>
            <Button onClick={submit} disabled={!driverId || busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("screens.driverLinking.link")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {t("screens.driverLinking.modalIntro").replace(
              "{name}",
              active?.name ?? active?.uber_driver_uuid ?? "",
            )}
          </p>
          <select
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-2 focus:ring-slate-200"
          >
            <option value="">{t("screens.driverLinking.selectPlaceholder")}</option>
            {driverOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {driverOptions.length === 0 && (
            <p className="text-xs text-amber-600">{t("screens.driverLinking.noDrivers")}</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
