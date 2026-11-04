"use client";

import { useId } from "react";
import { X, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { useDialogFocus } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * Small building blocks of the remade design system (prototype ui.*), shared by
 * the fleet-manager screens. They only emit the real classes from globals.css.
 */

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/** Stable avatar tint per name (t0..t5), same hash as the prototype. */
const toneOf = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `t${h % 6}`;
};

export type Presence = "online" | "en_route" | "on_trip" | "offline";
const PRES_COLOR: Record<Presence, string> = {
  online: "var(--success-dot)",
  en_route: "var(--warning-dot)",
  on_trip: "var(--info-dot)",
  offline: "var(--neutral-dot)",
};

export function Av({ name, size = "", presence }: { name: string; size?: "" | "sm" | "lg" | "xl"; presence?: Presence }) {
  const av = (
    <span className={cn("av", size, toneOf(name))} aria-hidden="true">
      {initials(name) || "?"}
    </span>
  );
  if (!presence) return av;
  return (
    <span className="av-wrap">
      {av}
      <i className="st" style={{ background: PRES_COLOR[presence] }} />
    </span>
  );
}

export function Who({
  name,
  sub,
  mono,
  presence,
  size,
}: {
  name: string;
  sub?: React.ReactNode;
  mono?: boolean;
  presence?: Presence;
  size?: "" | "sm";
}) {
  return (
    <div className="who">
      <Av name={name} size={size} presence={presence} />
      <div className="truncate">
        <div className="n truncate">{name}</div>
        {sub ? <div className={cn("s truncate", mono && "mono")}>{sub}</div> : null}
      </div>
    </div>
  );
}

export function SkelRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row" style={{ gap: 14 }}>
          <span className="skel" style={{ width: 32, height: 32, borderRadius: 10 }} />
          {Array.from({ length: cols }, (_, j) => (
            <span key={j} className="skel" style={{ height: 12, flex: j ? 1 : 2 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export type Tone = "" | "success" | "danger" | "warning" | "info" | "accent";

export function StatTile({
  label,
  value,
  icon: Icon,
  tone = "",
  toneValue,
  foot,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  toneValue?: boolean;
  foot?: React.ReactNode;
}) {
  const valueTone = toneValue ? ({ success: "pos", danger: "neg", warning: "warn" } as Record<string, string>)[tone] : "";
  return (
    <div className="stat">
      <div className="stat-top">
        {Icon && (
          <span className={cn("stat-ico", tone)}>
            <Icon />
          </span>
        )}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("stat-value", valueTone)}>{value}</div>
      {foot ? (
        <div className="stat-foot">
          <span className="truncate">{foot}</span>
        </div>
      ) : null}
    </div>
  );
}

export function PageHead({
  title,
  sub,
  actions,
  back,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  back?: React.ReactNode;
}) {
  return (
    <header className="ph">
      <div>
        {back}
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {actions ? <div className="ph-actions">{actions}</div> : null}
    </header>
  );
}

/** Table footer with range text and prev/next, as the prototype's ui.pager. */
export function PagerBar({
  range,
  page,
  lastPage,
  onPage,
}: {
  range: string;
  page: number;
  lastPage: number;
  onPage: (p: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="tbl-foot">
      <span>{range}</span>
      <div className="pager">
        <button type="button" disabled={page <= 1} aria-label={t("common.previousPage")} onClick={() => onPage(Math.max(1, page - 1))}>
          <ChevronLeft className="ico-sm rtl:rotate-180" />
        </button>
        <span className="num" style={{ padding: "0 6px" }}>
          {page} / {lastPage}
        </span>
        <button type="button" disabled={page >= lastPage} aria-label={t("common.nextPage")} onClick={() => onPage(Math.min(lastPage, page + 1))}>
          <ChevronRight className="ico-sm rtl:rotate-180" />
        </button>
      </div>
    </div>
  );
}

/** Prototype modal shell (overlay + .modal head/body/foot) with focus handling. */
export function ModalShell({
  onClose,
  title,
  sub,
  icon: Icon,
  tone = "",
  size = "",
  body,
  foot,
  head,
  bodyClassName,
}: {
  onClose: () => void;
  title?: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  size?: "" | "sm" | "lg";
  body: React.ReactNode;
  foot?: React.ReactNode;
  /** Replaces the default head (used by the offer detail's custom header). */
  head?: React.ReactNode;
  bodyClassName?: string;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const ref = useDialogFocus(true, onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cn("modal outline-none", size)}>
        {head ?? (
          <div className="modal-head">
            <div>
              {Icon && (
                <span className={cn("stat-ico", tone)} style={{ width: 36, height: 36, borderRadius: 10, marginBottom: 12 }}>
                  <Icon />
                </span>
              )}
              <h2 id={titleId}>{title}</h2>
              {sub ? <p>{sub}</p> : null}
            </div>
            <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={onClose}>
              <X />
            </button>
          </div>
        )}
        <div className={cn("modal-body", bodyClassName)}>{body}</div>
        {foot ? <div className="modal-foot">{foot}</div> : null}
      </div>
    </div>
  );
}
