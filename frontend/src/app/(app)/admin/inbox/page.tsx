"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Inbox, Mail, Phone, Trash2, MailOpen, MailCheck } from "lucide-react";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/utils";
import { useAsync } from "@/hooks/use-async";
import { ApiError } from "@/lib/api/client";
import { ADMIN_BADGES_REFRESH_EVENT } from "@/components/layout/app-feeds";
import {
  listContactMessages,
  setContactMessageRead,
  deleteContactMessage,
  type ContactMessage,
} from "@/lib/api/contact-messages";

export default function AdminInboxPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.inbox.${k}`);
  const { data, loading, refetch } = useAsync(listContactMessages);
  const messages = data?.messages ?? [];
  const unread = data?.unread ?? 0;

  const [deleting, setDeleting] = useState<ContactMessage | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggleRead(m: ContactMessage) {
    try {
      await setContactMessageRead(m.id, !m.read);
      refetch();
      window.dispatchEvent(new Event(ADMIN_BADGES_REFRESH_EVENT));
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
      window.dispatchEvent(new Event(ADMIN_BADGES_REFRESH_EVENT));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : c("error"));
    } finally {
      setBusy(false);
    }
  }

  const fmt = (iso: string | null) =>
    iso ? formatDateTime(iso, locale, { dateStyle: "medium", timeStyle: "short" }) : "";

  return (
    <>
      <header className="ph">
        <div>
          <h1>{c("title")}</h1>
          <p>{c("subtitle")}</p>
        </div>
        {unread > 0 && (
          <span className="badge success">
            <span className="dot" />
            {unread} {c("unread")}
          </span>
        )}
      </header>

      {loading && !data ? (
        <section className="card" style={{ padding: 16 }}>
          <div className="stack-sm">{[0, 1].map((k) => <div key={k} className="skel" style={{ height: 48 }} />)}</div>
        </section>
      ) : messages.length === 0 ? (
        <section className="card">
          <div className="empty">
            <span className="empty-ico"><Inbox /></span>
            <h3>{c("empty")}</h3>
            <p>{c("emptyDesc")}</p>
          </div>
        </section>
      ) : (
        <div className="stack-sm">
          {messages.map((m) => (
            <article
              key={m.id}
              className="card"
              style={{
                display: "flex",
                gap: 12,
                padding: "16px 18px",
                ...(m.read ? {} : { background: "var(--success-bg)", borderColor: "transparent" }),
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  marginTop: 7,
                  flexShrink: 0,
                  borderRadius: 99,
                  background: m.read ? "transparent" : "var(--success-dot)",
                }}
              />
              <div className="grow">
                <div className="row-wrap" style={{ gap: "6px 14px" }}>
                  <span className="strong">{m.name}</span>
                  <span className="subtle text-sm num">{fmt(m.created_at)}</span>
                  {!m.read && <span className="badge success">{c("unread")}</span>}
                </div>
                <div className="row-wrap text-sm" style={{ gap: "4px 16px", marginTop: 4 }}>
                  <a href={`mailto:${m.email}`} className="link row" style={{ gap: 6 }}>
                    <Mail className="ico-sm" style={{ width: 15, height: 15 }} />
                    {m.email}
                  </a>
                  {m.phone && (
                    <a href={`tel:${m.phone}`} className="link row" style={{ gap: 6 }}>
                      <Phone style={{ width: 15, height: 15 }} />
                      <span className="num" dir="ltr">{m.phone}</span>
                    </a>
                  )}
                </div>
                <p style={{ marginTop: 10, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{m.message}</p>
              </div>
              <div className="row" style={{ gap: 2, alignSelf: "flex-start" }}>
                <button
                  type="button"
                  onClick={() => toggleRead(m)}
                  className="icon-btn"
                  aria-label={m.read ? c("markUnread") : c("markRead")}
                  title={m.read ? c("markUnread") : c("markRead")}
                >
                  {m.read ? <MailCheck /> : <MailOpen />}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(m)}
                  className="icon-btn neg"
                  aria-label={c("delete")}
                  title={c("delete")}
                >
                  <Trash2 />
                </button>
              </div>
            </article>
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
    </>
  );
}
