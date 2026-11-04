"use client";

import { useId, useRef } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useDialogFocus } from "@/components/ui/modal";

/**
 * A small, reusable confirmation dialog matching the dashboard design. Controlled
 * by the parent via `open`; RTL-safe. Closes on overlay click / Escape (cancel).
 */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy = false,
  danger = false,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const titleId = useId();
  const messageId = useId();
  // Focus in/trap/restore + Escape (ignored while the action is running).
  const panelRef = useDialogFocus(open, () => !busyRef.current && onCancel());

  if (!open) return null;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        className="modal sm outline-none"
      >
        <div className="modal-head">
          <div>
            <span className={`stat-ico ${danger ? "danger" : ""}`} style={{ width: 36, height: 36, borderRadius: 10, marginBottom: 12 }}>
              <AlertTriangle />
            </span>
            <h2 id={titleId}>{title}</h2>
          </div>
        </div>
        <div className="modal-body">
          <p id={messageId} className="muted">{message}</p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 style={{ animation: "ofr-spin 1s linear infinite" }} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
