"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";

/**
 * Prev / "page X of Y" / next — RTL-mirrored arrows and labelled icon buttons,
 * so list pagers stop drifting apart. Renders nothing for a single page.
 */
export function Pager({
  page,
  lastPage,
  onPage,
  total,
  className = "",
}: {
  page: number;
  lastPage: number;
  onPage: (page: number) => void;
  /** Optional total row count shown next to the page indicator. */
  total?: number;
  className?: string;
}) {
  const { t, locale } = useI18n();
  if (lastPage <= 1) return null;
  const btn =
    "rounded-lg border border-line p-2 text-ink-muted transition hover:bg-surface-2 disabled:opacity-40";
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        aria-label={t("common.previousPage")}
        className={btn}
      >
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
      </button>
      <span className="text-sm tabular-nums text-ink-muted">
        {formatNumber(page, locale)} / {formatNumber(lastPage, locale)}
        {total != null ? ` · ${formatNumber(total, locale)}` : ""}
      </span>
      <button
        type="button"
        onClick={() => onPage(Math.min(lastPage, page + 1))}
        disabled={page >= lastPage}
        aria-label={t("common.nextPage")}
        className={btn}
      >
        <ChevronRight className="h-4 w-4 rtl:rotate-180" />
      </button>
    </div>
  );
}
