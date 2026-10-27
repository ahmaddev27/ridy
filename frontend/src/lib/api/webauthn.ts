import { apiFetch } from "./client";
import type { AuthUser } from "./auth";
import type { AuthenticationCredentialJSON, RegistrationCredentialJSON } from "@/lib/webauthn";

/** A passkey the signed-in user has registered. The server never returns key material. */
export type Passkey = {
  /** Opaque server id — only ever echoed back, never parsed. */
  id: string | number;
  alias: string | null;
  created_at: string;
};

/** A server-started ceremony: echo `ceremony_id` back together with the browser's answer. */
export type PasskeyCeremony<Options> = { ceremony_id: string; options: Options };

/** Start a username-less sign-in (public): the browser offers the passkeys it holds for this site. */
export async function passkeyLoginOptions(): Promise<PasskeyCeremony<PublicKeyCredentialRequestOptionsJSON>> {
  return apiFetch<PasskeyCeremony<PublicKeyCredentialRequestOptionsJSON>>("/api/v1/webauthn/login/options", {
    method: "POST",
    body: {},
    withCsrf: true,
    skipAuthEvents: true,
  });
}

/** Finish the sign-in. A suspended company answers 403 `account_suspended`, exactly like the password login. */
export async function passkeyLogin(ceremonyId: string, credential: AuthenticationCredentialJSON): Promise<AuthUser> {
  const res = await apiFetch<{ data: AuthUser }>("/api/v1/webauthn/login", {
    method: "POST",
    body: { ceremony_id: ceremonyId, credential },
    withCsrf: true,
    skipAuthEvents: true,
  });
  return res.data;
}

/**
 * Start adding a passkey to the signed-in account. Enrolment is a step-up:
 * the server re-checks the account password before handing out a ceremony,
 * so a hijacked session cannot plant a credential that would outlive it.
 */
export async function passkeyRegisterOptions(
  password: string,
): Promise<PasskeyCeremony<PublicKeyCredentialCreationOptionsJSON>> {
  return apiFetch<PasskeyCeremony<PublicKeyCredentialCreationOptionsJSON>>("/api/v1/webauthn/register/options", {
    method: "POST",
    body: { password },
    withCsrf: true,
  });
}

/** Finish adding a passkey; `alias` is an optional device name. */
export async function passkeyRegister(input: {
  ceremonyId: string;
  alias?: string;
  credential: RegistrationCredentialJSON;
}): Promise<Passkey> {
  const res = await apiFetch<{ data: Passkey }>("/api/v1/webauthn/register", {
    method: "POST",
    body: { ceremony_id: input.ceremonyId, alias: input.alias, credential: input.credential },
    withCsrf: true,
  });
  return res.data;
}

export async function listPasskeys(): Promise<Passkey[]> {
  const res = await apiFetch<{ data: Passkey[] }>("/api/v1/webauthn/credentials");
  return res.data;
}

export async function deletePasskey(id: Passkey["id"]): Promise<void> {
  await apiFetch<void>(`/api/v1/webauthn/credentials/${encodeURIComponent(String(id))}`, {
    method: "DELETE",
    withCsrf: true,
  });
}
