/**
 * Browser half of passkeys (WebAuthn).
 *
 * The server speaks the standard JSON encoding (binary values as base64url), so
 * a ceremony is: options (JSON) from the server -> the browser's passkey prompt
 * -> the credential (JSON) back to the server. Browsers with the native JSON
 * bridges (`parse…OptionsFromJSON` / `toJSON`) use them; older ones (Safari before
 * 18.4, Chrome before 129) get the same conversion from the fallbacks below.
 *
 * `window` / `navigator` are only touched inside functions, never at import
 * time, so the module is safe to prerender.
 */

type CredentialJSON = {
  id: string;
  rawId: string;
  type: string;
  authenticatorAttachment?: string;
  clientExtensionResults: Record<string, unknown>;
};

/** What the server verifies after `createPasskey` (the standard RegistrationResponseJSON). */
export type RegistrationCredentialJSON = CredentialJSON & {
  response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
};

/** What the server verifies after `getPasskey` (the standard AuthenticationResponseJSON). */
export type AuthenticationCredentialJSON = CredentialJSON & {
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string };
};

/** The user dismissed (or let time out) the browser's passkey prompt. Not an error to report. */
export class PasskeyCancelledError extends Error {
  constructor() {
    super("passkey_cancelled");
    this.name = "PasskeyCancelledError";
  }
}

/** This authenticator already holds a passkey for the account (the server's `excludeCredentials` matched). */
export class PasskeyAlreadyRegisteredError extends Error {
  constructor() {
    super("passkey_already_registered");
    this.name = "PasskeyAlreadyRegisteredError";
  }
}

/** True in a browser that exposes WebAuthn (secure contexts only); false while prerendering. */
export function supportsPasskeys(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

// ---------------------------------------------------------------------------
// base64url <-> ArrayBuffer (fallbacks only; the native bridges do this natively)
// ---------------------------------------------------------------------------

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function toBase64Url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// options: server JSON -> what navigator.credentials expects
// ---------------------------------------------------------------------------

function descriptorFromJSON(json: PublicKeyCredentialDescriptorJSON): PublicKeyCredentialDescriptor {
  return {
    type: json.type as PublicKeyCredentialType,
    id: fromBase64Url(json.id),
    transports: json.transports as AuthenticatorTransport[] | undefined,
  };
}

// The fallbacks leave `extensions` out on purpose: extension inputs can carry
// binary members this conversion does not know about, and a string where the
// browser wants a buffer would throw a TypeError instead of just skipping them.

function decodeCreationOptions(json: PublicKeyCredentialCreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    rp: json.rp,
    user: { id: fromBase64Url(json.user.id), name: json.user.name, displayName: json.user.displayName },
    challenge: fromBase64Url(json.challenge),
    pubKeyCredParams: json.pubKeyCredParams,
    timeout: json.timeout,
    excludeCredentials: json.excludeCredentials?.map(descriptorFromJSON),
    authenticatorSelection: json.authenticatorSelection,
    attestation: json.attestation as AttestationConveyancePreference | undefined,
  };
}

function decodeRequestOptions(json: PublicKeyCredentialRequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    challenge: fromBase64Url(json.challenge),
    rpId: json.rpId,
    timeout: json.timeout,
    allowCredentials: json.allowCredentials?.map(descriptorFromJSON),
    userVerification: json.userVerification as UserVerificationRequirement | undefined,
  };
}

// The native parsers are called as methods (never detached) or the browser
// throws "Illegal invocation".

function toCreationOptions(json: PublicKeyCredentialCreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return typeof window.PublicKeyCredential.parseCreationOptionsFromJSON === "function"
    ? window.PublicKeyCredential.parseCreationOptionsFromJSON(json)
    : decodeCreationOptions(json);
}

function toRequestOptions(json: PublicKeyCredentialRequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return typeof window.PublicKeyCredential.parseRequestOptionsFromJSON === "function"
    ? window.PublicKeyCredential.parseRequestOptionsFromJSON(json)
    : decodeRequestOptions(json);
}

// ---------------------------------------------------------------------------
// credential: what the browser returns -> JSON for the server
// ---------------------------------------------------------------------------

function baseToJSON(credential: PublicKeyCredential): CredentialJSON {
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: {},
  };
}

function registrationToJSON(credential: PublicKeyCredential): RegistrationCredentialJSON {
  if (typeof credential.toJSON === "function") return credential.toJSON();
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    ...baseToJSON(credential),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : [],
    },
  };
}

function authenticationToJSON(credential: PublicKeyCredential): AuthenticationCredentialJSON {
  if (typeof credential.toJSON === "function") return credential.toJSON();
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    ...baseToJSON(credential),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// ceremonies
// ---------------------------------------------------------------------------

// Matched by name, not `instanceof DOMException`: an error thrown from another
// realm (a password-manager extension, an iframe) would slip past the latter.
function errorName(err: unknown): string {
  return typeof err === "object" && err !== null && "name" in err ? String(err.name) : "";
}

function cancelledOr(err: unknown): unknown {
  return errorName(err) === "NotAllowedError" ? new PasskeyCancelledError() : err;
}

// A null credential means no prompt produced an answer: treat it like a dismissal.
function expectCredential(credential: Credential | null): PublicKeyCredential {
  if (!credential) throw new PasskeyCancelledError();
  return credential as PublicKeyCredential;
}

/**
 * Create a passkey on this device from the server's creation options.
 *
 * @throws PasskeyCancelledError when the prompt is dismissed (stay silent)
 * @throws PasskeyAlreadyRegisteredError when this authenticator already has one for the account
 */
export async function createPasskey(
  optionsJson: PublicKeyCredentialCreationOptionsJSON,
): Promise<RegistrationCredentialJSON> {
  try {
    const credential = await navigator.credentials.create({ publicKey: toCreationOptions(optionsJson) });
    return registrationToJSON(expectCredential(credential));
  } catch (err) {
    if (errorName(err) === "InvalidStateError") throw new PasskeyAlreadyRegisteredError();
    throw cancelledOr(err);
  }
}

/**
 * Sign in with a passkey the browser offers for this site (username-less: the
 * server sends no `allowCredentials`).
 *
 * @throws PasskeyCancelledError when the prompt is dismissed (stay silent)
 */
export async function getPasskey(
  optionsJson: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationCredentialJSON> {
  try {
    const credential = await navigator.credentials.get({ publicKey: toRequestOptions(optionsJson) });
    return authenticationToJSON(expectCredential(credential));
  } catch (err) {
    throw cancelledOr(err);
  }
}
