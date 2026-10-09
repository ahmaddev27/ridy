"use client";

/**
 * The El-Professor link, on a page of its own.
 *
 * It lived at the bottom of Connections until 09.10.2026, and that page is the
 * **Uber** link: a session captured by the browser extension, with its own
 * reconnect flow and its own failure modes. Two unrelated integrations under
 * one heading made the company read both to find the one it wanted, and made
 * "Verbindung" mean two different things on one screen.
 *
 * The page is reached only while the platform has opened the link for this
 * company — the sidebar hides it (`requiresElProfessor`) and every route behind
 * it answers 403 `integration_disabled` otherwise. The card itself still reads
 * its own state while closed, so this page can say why rather than fail.
 */

import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";
import { ElProfessorCard } from "./elprofessor-card";

export default function ElProfessorPage() {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("screens.connections.pageTitleEp")}
        subtitle={t("screens.connections.pageSubtitleEp")}
      />
      <ElProfessorCard />
    </div>
  );
}
