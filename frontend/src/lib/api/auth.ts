import { apiFetch } from "./client";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  tenant: { id: number; name: string } | null;
  roles: string[];
  permissions: string[];
};

export async function login(email: string, password: string, remember = false): Promise<AuthUser> {
  const res = await apiFetch<{ data: AuthUser }>("/api/v1/login", {
    method: "POST",
    body: { email, password, remember },
    withCsrf: true,
  });
  return res.data;
}

export async function logout(): Promise<void> {
  await apiFetch<void>("/api/v1/logout", { method: "POST", withCsrf: true });
}

/** `/me` returns the user under `data` plus a sibling `impersonating` flag that
 *  is true while a super-admin is acting as a company manager. */
export type MeResult = { user: AuthUser; impersonating: boolean };

export async function fetchMe(): Promise<MeResult> {
  const res = await apiFetch<{ data: AuthUser; impersonating?: boolean }>("/api/v1/me");
  return { user: res.data, impersonating: Boolean(res.impersonating) };
}

/** The authenticated user updates their own account. */
export async function updateProfile(input: {
  name?: string;
  email?: string;
  password?: string;
  password_confirmation?: string;
}): Promise<AuthUser> {
  const res = await apiFetch<{ data: AuthUser }>("/api/v1/profile", {
    method: "PUT",
    body: input,
    withCsrf: true,
  });
  return res.data;
}
