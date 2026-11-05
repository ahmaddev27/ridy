"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

const sizeClass = { md: "sm", lg: "", xl: "lg", wide: "wide" } as const;

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

  // Portal to <body>: a transformed/animated ancestor (the page settle animation)
  // would otherwise become the containing block of the fixed overlay and clip
  // the blur to the content area.
  const dialog = (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`modal ${sizeClass[size]} outline-none`}
      >
        {title && (
          <div className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" onClick={onClose} className="icon-btn" aria-label={t("common.close")}>
              <X />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
