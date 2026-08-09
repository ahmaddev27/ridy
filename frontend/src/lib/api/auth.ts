import { apiFetch } from "./client";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  tenant: { id: number; name: string } | null;
  roles: string[];
  permissions: string[];
};

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await apiFetch<{ data: AuthUser }>("/api/v1/login", {
    method: "POST",
    body: { email, password },
    withCsrf: true,
  });
  return res.data;
}

export async function logout(): Promise<void> {
  await apiFetch<void>("/api/v1/logout", { method: "POST", withCsrf: true });
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await apiFetch<{ data: AuthUser }>("/api/v1/me");
  return res.data;
}

/** The authenticated user updates their own account. */
export async function updateProfile(input: {
  name?: string;
  email?: string;
  password?: string;
}): Promise<AuthUser> {
  const res = await apiFetch<{ data: AuthUser }>("/api/v1/profile", {
    method: "PUT",
    body: input,
    withCsrf: true,
  });
  return res.data;
}
