"use client";

import { useEffect } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-surface text-start shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                danger ? "bg-danger-bg text-danger-fg" : "bg-surface-2 text-ink"
              }`}
            >
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-ink">{title}</h2>
              <p className="mt-1 text-sm text-ink-muted">{message}</p>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={busy}
            className={danger ? "bg-danger-ring text-white hover:opacity-90" : undefined}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
