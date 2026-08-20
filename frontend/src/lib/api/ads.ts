import { apiFetch } from "./client";

/** A platform-wide promotional ad managed by the super-admin. */
export type Ad = {
  id: number;
  title: string;
  body: string | null;
  image_url: string | null;
  link_url: string | null;
  cta_label: string | null;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

export type AdInput = {
  title: string;
  body?: string | null;
  image_url?: string | null;
  link_url?: string | null;
  cta_label?: string | null;
  active?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
};

/** The live ad shown to a company on its Offers view (or null when none). */
export type CurrentAd = Pick<Ad, "id" | "title" | "body" | "image_url" | "link_url" | "cta_label">;

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

/** The current live ad for the signed-in company's Offers slot. */
export async function getCurrentAd(): Promise<CurrentAd | null> {
  const res = await apiFetch<{ data: CurrentAd | null }>("/api/v1/ads/current");
  return res.data;
}
