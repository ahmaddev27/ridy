import { apiFetch } from "./client";

export type ElProfessorToken = {
  token: string;
  tenant_id: number;
  tenant_name: string;
  payment_reference: string;
};

export type ElProfessorConnection = {
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

/** Connection state only — the server never returns the token itself. */
export async function getElProfessorConnection(): Promise<ElProfessorConnection> {
  const res = await apiFetch<{ data: ElProfessorConnection }>("/api/v1/elprofessor/connection");
  return res.data;
}
