"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Megaphone, Plus, Pencil, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listAds, createAd, updateAd, deleteAd, uploadAdImage, type Ad, type AdInput } from "@/lib/api/ads";
import { ImageCropper } from "@/components/ads/image-cropper";
import { ApiError } from "@/lib/api/client";

/** Turn an ISO datetime into a value a `datetime-local` input accepts. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value → ISO string (or null when empty). */
function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export default function AdminAdsPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.ads.${k}`);
  const { data, refetch } = useAsync(listAds);
  const ads = data ?? [];

  const [editing, setEditing] = useState<Ad | "new" | null>(null);
  const [deleting, setDeleting] = useState<Ad | null>(null);
  const [busy, setBusy] = useState(false);

  async function doDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteAd(deleting.id);
      toast.success(c("deleted"));
      setDeleting(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : c("error"));
    } finally {
      setBusy(false);
    }
  }

  function windowLabel(ad: Ad): string {
    const fmt = (iso: string) => new Date(iso).toLocaleDateString(locale);
    if (ad.starts_at && ad.ends_at) return `${fmt(ad.starts_at)} – ${fmt(ad.ends_at)}`;
    if (ad.starts_at) return `${c("from")} ${fmt(ad.starts_at)}`;
    if (ad.ends_at) return `${c("until")} ${fmt(ad.ends_at)}`;
    return c("always");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={c("title")}
        subtitle={c("subtitle")}
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" />
            {c("create")}
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {ads.length === 0 ? (
          <EmptyState icon={Megaphone} title={c("empty")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-start text-xs text-ink-subtle">
                  <th className="px-4 py-3 text-start font-medium">{c("colTitle")}</th>
                  <th className="px-4 py-3 text-start font-medium">{c("colStatus")}</th>
                  <th className="px-4 py-3 text-start font-medium">{c("colWindow")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ads.map((ad) => (
                  <tr key={ad.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {ad.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={ad.image_url.startsWith("http") ? ad.image_url : `${process.env.NEXT_PUBLIC_API_URL ?? ""}${ad.image_url}`}
                            alt=""
                            className="h-8 w-20 shrink-0 rounded border border-line object-cover"
                          />
                        ) : (
                          <div className="h-8 w-20 shrink-0 rounded border border-line bg-surface-2" />
                        )}
                        <span className="font-medium text-ink">{ad.title || `#${ad.id}`}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={ad.active ? "connected" : "neutral"} dot>
                        {ad.active ? c("active") : c("inactive")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{windowLabel(ad)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditing(ad)}
                          className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-2"
                          aria-label={c("edit")}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleting(ad)}
                          className="rounded-lg p-1.5 text-danger-fg hover:bg-danger-bg"
                          aria-label={c("delete")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <AdFormModal
          ad={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
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

function AdFormModal({ ad, onClose, onSaved }: { ad: Ad | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.ads.${k}`);

  const [imageUrl, setImageUrl] = useState(ad?.image_url ?? "");
  const [linkUrl, setLinkUrl] = useState(ad?.link_url ?? "");
  const [ctaLabel, setCtaLabel] = useState(ad?.cta_label ?? "");
  const [active, setActive] = useState(ad?.active ?? true);
  const [startsAt, setStartsAt] = useState(toLocalInput(ad?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(ad?.ends_at ?? null));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  // Uploaded images are stored as same-origin relative URLs; in dev they resolve
  // against the API host, in production they are same-origin behind the edge.
  const previewSrc = imageUrl
    ? imageUrl.startsWith("http")
      ? imageUrl
      : `${process.env.NEXT_PUBLIC_API_URL ?? ""}${imageUrl}`
    : "";

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (file) setCropFile(file); // open the cropper before uploading
  }

  async function onCropped(blob: Blob) {
    setCropFile(null);
    setUploading(true);
    setErrors({});
    try {
      setImageUrl(await uploadAdImage(blob));
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast.error(err instanceof ApiError ? err.message : c("error"));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    const input: AdInput = {
      image_url: imageUrl.trim() || null,
      link_url: linkUrl.trim() || null,
      cta_label: ctaLabel.trim() || null,
      active,
      starts_at: fromLocalInput(startsAt),
      ends_at: fromLocalInput(endsAt),
    };
    try {
      if (ad) await updateAd(ad.id, input);
      else await createAd(input);
      toast.success(c("saved"));
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e instanceof ApiError ? e.message : c("error"));
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-line";
  const err = (k: string) => errors[k]?.[0];

  return (
    <Modal
      open
      onClose={onClose}
      title={ad ? c("editTitle") : c("createTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {c("cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || uploading || !imageUrl}>
            {c("save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">{c("fieldImage")}</label>
          <p className="mb-2 text-xs text-ink-subtle">{c("imageHint")}</p>
          {previewSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewSrc}
              alt=""
              className="mb-2 h-32 w-full rounded-lg border border-line object-cover"
            />
          )}
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink hover:bg-surface-2">
              <input type="file" accept="image/*" onChange={onPickImage} className="hidden" disabled={uploading} />
              {uploading ? c("uploading") : previewSrc ? c("changeImage") : c("uploadImage")}
            </label>
            {previewSrc && !uploading && (
              <button
                type="button"
                onClick={() => setImageUrl("")}
                className="text-sm text-danger-fg hover:underline"
              >
                {c("removeImage")}
              </button>
            )}
          </div>
          {(err("image") || err("image_url")) && (
            <p className="mt-1 text-xs text-danger-fg">{err("image") ?? err("image_url")}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">{c("fieldLinkUrl")}</label>
          <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className={field} placeholder="https://" />
          {err("link_url") && <p className="mt-1 text-xs text-danger-fg">{err("link_url")}</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">{c("fieldCtaLabel")}</label>
          <input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} className={field} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink">{c("fieldStartsAt")}</label>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={field} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink">{c("fieldEndsAt")}</label>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={field} />
            {err("ends_at") && <p className="mt-1 text-xs text-danger-fg">{err("ends_at")}</p>}
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {c("fieldActive")}
        </label>
      </div>

      {cropFile && (
        <ImageCropper file={cropFile} aspect={4 / 1} onCancel={() => setCropFile(null)} onCropped={onCropped} />
      )}
    </Modal>
  );
}
