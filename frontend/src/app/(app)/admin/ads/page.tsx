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
                        {(ad.image_desktop ?? ad.image_url) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={resolveSrc((ad.image_desktop ?? ad.image_url) as string)}
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

/** The three device images an ad needs, with their crop aspect + recommended size. */
const AD_IMAGES = [
  { key: "image_desktop", label: "Desktop", aspect: 4 / 1, rec: "1280 × 320" },
  { key: "image_tablet", label: "Tablet", aspect: 5 / 2, rec: "800 × 320" },
  { key: "image_mobile", label: "Mobile", aspect: 16 / 10, rec: "640 × 400" },
] as const;

type ImageKey = (typeof AD_IMAGES)[number]["key"];

function resolveSrc(url: string): string {
  if (!url) return "";
  return url.startsWith("http") ? url : `${process.env.NEXT_PUBLIC_API_URL ?? ""}${url}`;
}

function AdFormModal({ ad, onClose, onSaved }: { ad: Ad | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.ads.${k}`);

  const [images, setImages] = useState<Record<ImageKey, string>>({
    image_desktop: ad?.image_desktop ?? "",
    image_tablet: ad?.image_tablet ?? "",
    image_mobile: ad?.image_mobile ?? "",
  });
  const [linkUrl, setLinkUrl] = useState(ad?.link_url ?? "");
  const [active, setActive] = useState(ad?.active ?? true);
  const [startsAt, setStartsAt] = useState(toLocalInput(ad?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(ad?.ends_at ?? null));
  const [busy, setBusy] = useState(false);
  // Which device slot is currently uploading (null = none), and the file being cropped.
  const [uploadingKey, setUploadingKey] = useState<ImageKey | null>(null);
  const [crop, setCrop] = useState<{ key: ImageKey; aspect: number; file: File } | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const allImagesSet = AD_IMAGES.every((img) => images[img.key].trim() !== "");

  function onPick(key: ImageKey, aspect: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (file) setCrop({ key, aspect, file });
  }

  async function onCropped(blob: Blob) {
    if (!crop) return;
    const key = crop.key;
    setCrop(null);
    setUploadingKey(key);
    setErrors({});
    try {
      const url = await uploadAdImage(blob);
      setImages((prev) => ({ ...prev, [key]: url }));
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast.error(err instanceof ApiError ? err.message : c("error"));
    } finally {
      setUploadingKey(null);
    }
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    const input: AdInput = {
      image_desktop: images.image_desktop.trim() || null,
      image_tablet: images.image_tablet.trim() || null,
      image_mobile: images.image_mobile.trim() || null,
      link_url: linkUrl.trim() || null,
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
          <Button onClick={submit} disabled={busy || uploadingKey !== null || !allImagesSet}>
            {c("save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* One image per device — all three required. The whole image is the ad
            (design your own button into it); no separate CTA button is shown. */}
        <div className="space-y-3">
          <p className="text-xs text-ink-subtle">{c("deviceImagesHint")}</p>
          {AD_IMAGES.map((img) => {
            const url = images[img.key];
            const preview = resolveSrc(url);
            const uploading = uploadingKey === img.key;
            return (
              <div key={img.key} className="rounded-lg border border-line p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink">{img.label}</span>
                  <span className="text-[11px] text-ink-subtle">{c("recommended")}: {img.rec} px</span>
                </div>
                {preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" className="mb-2 max-h-28 w-full rounded border border-line object-contain" />
                )}
                <div className="flex items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => onPick(img.key, img.aspect, e)}
                      className="hidden"
                      disabled={uploading}
                    />
                    {uploading ? c("uploading") : preview ? c("changeImage") : c("uploadImage")}
                  </label>
                  {preview && !uploading && (
                    <button
                      type="button"
                      onClick={() => setImages((prev) => ({ ...prev, [img.key]: "" }))}
                      className="text-sm text-danger-fg hover:underline"
                    >
                      {c("removeImage")}
                    </button>
                  )}
                </div>
                {err(img.key) && <p className="mt-1 text-xs text-danger-fg">{err(img.key)}</p>}
              </div>
            );
          })}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">{c("fieldLinkUrl")}</label>
          <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className={field} placeholder="https://" />
          {err("link_url") && <p className="mt-1 text-xs text-danger-fg">{err("link_url")}</p>}
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

      {crop && (
        <ImageCropper file={crop.file} aspect={crop.aspect} onCancel={() => setCrop(null)} onCropped={onCropped} />
      )}
    </Modal>
  );
}
