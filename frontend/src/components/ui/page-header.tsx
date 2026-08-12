"use client";

import { useI18n } from "@/lib/i18n/context";

export function PageHeader({
  tkey,
  title,
  subtitle,
  action,
}: {
  /** i18n key under `pages.<tkey>` resolving `.title` and `.subtitle`. */
  tkey?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const { t } = useI18n();
  const resolvedTitle = tkey ? t(`pages.${tkey}.title`) : title;
  const resolvedSubtitle = tkey ? t(`pages.${tkey}.subtitle`) : subtitle;

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">{resolvedTitle}</h1>
        {resolvedSubtitle && <p className="mt-1 text-sm text-ink-muted">{resolvedSubtitle}</p>}
      </div>
      {action}
    </div>
  );
}
