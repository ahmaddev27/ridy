"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Megaphone, Plus, Pencil, Trash2, Upload, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";
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
  const { data, loading, refetch } = useAsync(listAds);
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
    const fmt = (iso: string) => formatDate(iso, locale);
    if (ad.starts_at && ad.ends_at) return `${fmt(ad.starts_at)} – ${fmt(ad.ends_at)}`;
    if (ad.starts_at) return `${c("from")} ${fmt(ad.starts_at)}`;
    if (ad.ends_at) return `${c("until")} ${fmt(ad.ends_at)}`;
    return c("always");
  }

  return (
    <>
      <header className="ph">
        <div>
          <h1>{c("title")}</h1>
          <p>{c("subtitle")}</p>
        </div>
        <div className="ph-actions">
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus />
            {c("create")}
          </button>
        </div>
      </header>

      <section className="card table-card">
        {loading && !data ? (
          <div className="stack-sm" style={{ padding: 16 }}>{[0, 1].map((k) => <div key={k} className="skel" style={{ height: 48 }} />)}</div>
        ) : ads.length === 0 ? (
          <div className="empty">
            <span className="empty-ico"><Megaphone /></span>
            <h3>{c("empty")}</h3>
            <p>{c("emptyDesc")}</p>
            <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus />
              {c("create")}
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{c("colTitle")}</th>
                  <th>{c("colStatus")}</th>
                  <th>{c("colWindow")}</th>
                  <th className="r"><span className="sr-only">{c("edit")}</span></th>
                </tr>
              </thead>
              <tbody>
                {ads.map((ad) => {
                  const thumb = ad.image_desktop ?? ad.image_url;
                  return (
                    <tr key={ad.id}>
                      <td>
                        <div className="row" style={{ gap: 12 }}>
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={resolveSrc(thumb)}
                              alt=""
                              style={{ width: 80, height: 32, flexShrink: 0, borderRadius: 6, objectFit: "cover", border: "1px solid var(--line)" }}
                            />
                          ) : (
                            <span style={{ width: 80, height: 32, flexShrink: 0, borderRadius: 6, background: "var(--surface-3)" }} />
                          )}
                          <span className="strong truncate">{ad.title || `#${ad.id}`}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${ad.active ? "success" : ""}`}>
                          <span className="dot" />
                          {ad.active ? c("active") : c("inactive")}
                        </span>
                      </td>
                      <td className="num nowrap">{windowLabel(ad)}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" onClick={() => setEditing(ad)} className="icon-btn" aria-label={c("edit")} title={c("edit")}>
                            <Pencil />
                          </button>
                          <button type="button" onClick={() => setDeleting(ad)} className="icon-btn neg" aria-label={c("delete")} title={c("delete")}>
                            <Trash2 />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
    </>
  );
}

/** The three device images an ad needs, with their crop aspect + recommended size. */
const AD_IMAGES = [
  { key: "image_desktop", labelKey: "device_desktop", aspect: 4 / 1, rec: "1280 × 320" },
  { key: "image_tablet", labelKey: "device_tablet", aspect: 5 / 2, rec: "800 × 320" },
  { key: "image_mobile", labelKey: "device_mobile", aspect: 16 / 10, rec: "640 × 400" },
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
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!(busy || uploadingKey !== null || !allImagesSet)) void submit();
        }}
      >
        {/* One image per device, all three required. The whole image is the ad
            (design your own button into it); no separate CTA button is shown. */}
        <div className="stack-sm">
          <p className="subtle text-xs">{c("deviceImagesHint")}</p>
          {AD_IMAGES.map((img) => {
            const url = images[img.key];
            const preview = resolveSrc(url);
            const uploading = uploadingKey === img.key;
            return (
              <div key={img.key} className="card inset" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="strong">{c(img.labelKey)}</span>
                  <span className="subtle text-xs num">{c("recommended")}: {img.rec} px</span>
                </div>
                <div
                  style={{
                    aspectRatio: img.aspect,
                    maxHeight: 112,
                    borderRadius: "var(--r-md)",
                    overflow: "hidden",
                    border: preview ? "1px solid var(--line)" : "1.5px dashed var(--line-strong)",
                    display: "grid",
                    placeItems: "center",
                    color: "var(--ink-subtle)",
                  }}
                >
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  ) : (
                    <ImagePlus style={{ width: 22, height: 22 }} />
                  )}
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <label className={`btn btn-secondary btn-sm${uploading ? " opacity-60" : ""}`} style={{ cursor: "pointer" }}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => onPick(img.key, img.aspect, e)}
                      className="hidden"
                      disabled={uploading}
                    />
                    <Upload />
                    {uploading ? c("uploading") : preview ? c("changeImage") : c("uploadImage")}
                  </label>
                  {preview && !uploading && (
                    <button
                      type="button"
                      onClick={() => setImages((prev) => ({ ...prev, [img.key]: "" }))}
                      className="link neg text-sm"
                      style={{ background: "none", border: 0, cursor: "pointer" }}
                    >
                      {c("removeImage")}
                    </button>
                  )}
                </div>
                {err(img.key) && <p className="text-xs neg">{err(img.key)}</p>}
              </div>
            );
          })}
        </div>
        <div className="field">
          <label>{c("fieldLinkUrl")}</label>
          <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className="input" placeholder="https://" dir="ltr" />
          {err("link_url") && <span className="err">{err("link_url")}</span>}
        </div>
        <div className="form-grid">
          <div className="field">
            <label>{c("fieldStartsAt")}</label>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="input" />
          </div>
          <div className="field">
            <label>{c("fieldEndsAt")}</label>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="input" />
            {err("ends_at") && <span className="err">{err("ends_at")}</span>}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>{c("fieldActive")}</span>
        </label>
      </form>

      {crop && (
        <ImageCropper file={crop.file} aspect={crop.aspect} onCancel={() => setCrop(null)} onCropped={onCropped} />
      )}
    </Modal>
  );
}
