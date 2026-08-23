"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Inbox, Mail, Phone, Trash2, MailOpen, MailCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { ApiError } from "@/lib/api/client";
import {
  listContactMessages,
  setContactMessageRead,
  deleteContactMessage,
  type ContactMessage,
} from "@/lib/api/contact-messages";

export default function AdminInboxPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.inbox.${k}`);
  const { data, refetch } = useAsync(listContactMessages);
  const messages = data?.messages ?? [];
  const unread = data?.unread ?? 0;

  const [deleting, setDeleting] = useState<ContactMessage | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggleRead(m: ContactMessage) {
    try {
      await setContactMessageRead(m.id, !m.read);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : c("error"));
    }
  }

  async function doDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteContactMessage(deleting.id);
      toast.success(c("deleted"));
      setDeleting(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : c("error"));
    } finally {
      setBusy(false);
    }
  }

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "";

  return (
    <div className="space-y-6">
      <PageHeader
        title={c("title")}
        subtitle={c("subtitle")}
        action={unread > 0 ? <Badge status="connected" dot>{unread} {c("unread")}</Badge> : undefined}
      />

      {messages.length === 0 ? (
        <Card className="overflow-hidden">
          <EmptyState icon={Inbox} title={c("empty")} description={c("emptyDesc")} />
        </Card>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <Card
              key={m.id}
              className={`p-5 ${m.read ? "" : "border-primary/40 bg-surface-2"}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {!m.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />}
                    <span className="font-semibold text-ink">{m.name}</span>
                    <span className="text-xs text-ink-subtle">{fmt(m.created_at)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
                    <a href={`mailto:${m.email}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                      <Mail className="h-3.5 w-3.5" /> {m.email}
                    </a>
                    {m.phone && (
                      <a href={`tel:${m.phone}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                        <Phone className="h-3.5 w-3.5" /> {m.phone}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => toggleRead(m)}
                    className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-2"
                    aria-label={m.read ? c("markUnread") : c("markRead")}
                    title={m.read ? c("markUnread") : c("markRead")}
                  >
                    {m.read ? <MailOpen className="h-4 w-4" /> : <MailCheck className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => setDeleting(m)}
                    className="rounded-lg p-1.5 text-danger-fg hover:bg-danger-bg"
                    aria-label={c("delete")}
                    title={c("delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{m.message}</p>
            </Card>
          ))}
        </div>
      )}

      <ConfirmModal
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={doDelete}
        title={c("deleteTitle")}
        message={c("deleteConfirm")}
        confirmLabel={c("delete")}
        cancelLabel={c("cancel")}
        busy={busy}
        danger
      />
    </div>
  );
}
