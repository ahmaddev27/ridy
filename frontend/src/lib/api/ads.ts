import { apiFetch, apiUpload } from "./client";

/** A platform-wide promotional ad managed by the super-admin. Image-only: the
 *  admin designs one image per device (mobile / tablet / desktop) with its own
 *  baked-in button, and the whole image is the click target — no CTA button. */
export type Ad = {
  id: number;
  title: string | null;
  image_mobile: string | null;
  image_tablet: string | null;
  image_desktop: string | null;
  /** Legacy single image, kept only for old ads. */
  image_url: string | null;
  link_url: string | null;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

export type AdInput = {
  title?: string | null;
  image_mobile?: string | null;
  image_tablet?: string | null;
  image_desktop?: string | null;
  link_url?: string | null;
  active?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
};

/** The live ad shown to a company on its banner slot (empty when none). */
export type CurrentAd = Pick<Ad, "id" | "image_mobile" | "image_tablet" | "image_desktop" | "link_url">;

const adminBase = "/api/v1/admin/ads";

export async function listAds(): Promise<Ad[]> {
  const res = await apiFetch<{ data: Ad[] }>(adminBase);
  return res.data;
}

export async function createAd(input: AdInput): Promise<Ad> {
  const res = await apiFetch<{ data: Ad }>(adminBase, { method: "POST", body: input, withCsrf: true });
  return res.data;
}

export async function updateAd(id: number, input: AdInput): Promise<Ad> {
  const res = await apiFetch<{ data: Ad }>(`${adminBase}/${id}`, { method: "PUT", body: input, withCsrf: true });
  return res.data;
}

export async function deleteAd(id: number): Promise<void> {
  await apiFetch(`${adminBase}/${id}`, { method: "DELETE", withCsrf: true });
}

/** Upload an ad image (raw file or cropped blob); returns the URL for image_url. */
export async function uploadAdImage(image: Blob): Promise<string> {
  const form = new FormData();
  const name = image instanceof File ? image.name : "ad.webp";
  form.append("image", image, name);
  const res = await apiUpload<{ data: { url: string } }>(`${adminBase}/upload`, form);
  return res.data.url;
}

/** All currently-live ads for the signed-in company's banner slot (empty when none). */
export async function getLiveAds(): Promise<CurrentAd[]> {
  const res = await apiFetch<{ data: CurrentAd[] }>("/api/v1/ads/current");
  return res.data ?? [];
}
