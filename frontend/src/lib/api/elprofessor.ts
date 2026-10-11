import { apiFetch } from "./client";

export type ElProfessorToken = {
  token: string;
  tenant_id: number;
  tenant_name: string;
  payment_reference: string;
};

export type ElProfessorConnection = {
  /** The PLATFORM's switch: whether this company has the integration at all. */
  enabled: boolean;
  /** The COMPANY's own switch: may its drivers attach a receipt from the
   *  gallery, or only from the camera? */
  gallery_import: boolean;
  connected: boolean;
  token_issued_at: string | null;
  first_used_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
};

/** Issues a token (shown once; replaces any previous one). */
export async function issueElProfessorToken(): Promise<ElProfessorToken> {
  const res = await apiFetch<{ data: ElProfessorToken }>("/api/v1/elprofessor/token", {
    method: "POST",
    withCsrf: true,
  });
  return res.data;
}

export async function revokeElProfessorToken(): Promise<void> {
  await apiFetch<unknown>("/api/v1/elprofessor/token", { method: "DELETE", withCsrf: true });
}

/**
 * The company's own setting: may a driver attach a receipt from the gallery?
 *
 * Off by default on the server. A camera photo is taken now, of something in
 * front of the driver; a gallery photo can be any image on the phone.
 */
export async function setElProfessorGalleryImport(enabled: boolean): Promise<ElProfessorConnection> {
  const res = await apiFetch<{ data: ElProfessorConnection }>("/api/v1/elprofessor/settings", {
    method: "PATCH",
    body: { gallery_import: enabled },
    withCsrf: true,
  });
  return res.data;
}

/** Connection state only — the server never returns the token itself. */
export async function getElProfessorConnection(): Promise<ElProfessorConnection> {
  const res = await apiFetch<{ data: ElProfessorConnection }>("/api/v1/elprofessor/connection");
  return res.data;
}
