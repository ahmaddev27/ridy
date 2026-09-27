"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

const sizeClass = { md: "max-w-md", lg: "max-w-lg", xl: "max-w-2xl" } as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard/screen-reader behaviour shared by the app's dialogs: moves focus into
 * the dialog on open, keeps Tab inside it, closes on Escape and returns focus to
 * whatever opened it.
 */
export function useDialogFocus(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Remember the opener before the dialog mounts (an autoFocus field inside the
  // dialog grabs focus during commit, before effects run).
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== "undefined") {
    openerRef.current = document.activeElement as HTMLElement | null;
  }
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;
    const opener = openerRef.current;
    const panel = panelRef.current;
    // Respect an autoFocus field; otherwise focus the dialog itself.
    if (panel && !panel.contains(document.activeElement)) panel.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open]);

  return panelRef;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: keyof typeof sizeClass;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const panelRef = useDialogFocus(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`relative max-h-[88vh] w-full overflow-y-auto rounded-xl bg-surface p-6 shadow-xl outline-none ${sizeClass[size]}`}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h3 id={titleId} className="text-lg font-semibold text-ink">{title}</h3>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-2"
              aria-label={t("common.close")}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="text-sm text-ink-muted">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
