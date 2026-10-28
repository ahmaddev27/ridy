import { Platform } from "react-native";
import { Passkey } from "react-native-passkey";
import type { PasskeyCreateRequest, PasskeyGetRequest } from "react-native-passkey";

/**
 * Native half of passkeys (WebAuthn) — the ONLY file that imports the module,
 * so swapping `react-native-passkey` for the other candidate
 * (`react-native-passkeys`, docs/22 §4.2) is a change to this file alone.
 *
 * Same JSON contract family as the dashboard's `frontend/src/lib/webauthn.ts`:
 * the server hands over the standard WebAuthn options JSON (binary values as
 * base64url) and expects the standard credential JSON back.
 */

/** First Android release with platform passkeys (Credential Manager). */
const ANDROID_PASSKEY_API = 28;

type CredentialJSON = {
  id: string;
  rawId: string;
  type: "public-key";
  authenticatorAttachment?: string;
  clientExtensionResults: Record<string, unknown>;
};

/** What the server verifies after `createPasskey` (RegistrationResponseJSON). */
export type RegistrationCredentialJSON = CredentialJSON & {
  response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
};

/** What the server verifies after `getPasskey` (AuthenticationResponseJSON). */
export type AuthenticationCredentialJSON = CredentialJSON & {
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string };
};

/** The server's options for a registration ceremony (PublicKeyCredentialCreationOptionsJSON). */
export type CreationOptionsJSON = PasskeyCreateRequest;
/** The server's options for a sign-in ceremony (PublicKeyCredentialRequestOptionsJSON). */
export type RequestOptionsJSON = PasskeyGetRequest;

/** The user dismissed (or let time out) the OS sheet. A choice, not an error. */
export class PasskeyCancelledError extends Error {
  constructor() {
    super("passkey_cancelled");
    this.name = "PasskeyCancelledError";
  }
}

/** This device's authenticator already holds a passkey for the account (`excludeCredentials` matched). */
export class PasskeyAlreadyRegisteredError extends Error {
  constructor() {
    super("passkey_already_registered");
    this.name = "PasskeyAlreadyRegisteredError";
  }
}

/** The device holds no passkey for this site — not a failure, just nothing to sign with. */
export class PasskeyNoneOnDeviceError extends Error {
  constructor() {
    super("passkey_none_on_device");
    this.name = "PasskeyNoneOnDeviceError";
  }
}

/** Whether this device can run a passkey ceremony at all. Never throws. */
export async function passkeysAvailable(): Promise<boolean> {
  try {
    // iOS: the app's floor (16.4) is already above the passkey floor.
    if (Platform.OS === "ios") return true;
    if (Platform.OS !== "android") return false;
    return Number(Platform.Version) >= ANDROID_PASSKEY_API && Passkey.isSupported();
  } catch {
    return false;
  }
}

// The module rejects with a plain `{ error, message }` object, not an Error.
const CANCEL_CODES = new Set(["UserCancelled", "Interrupted", "TimedOut"]);

function toTypedError(e: unknown): unknown {
  const code = (e as { error?: unknown } | null)?.error;
  if (typeof code === "string" && CANCEL_CODES.has(code)) return new PasskeyCancelledError();
  if (code === "CredentialAlreadyExists") return new PasskeyAlreadyRegisteredError();
  if (code === "NoCredentials") return new PasskeyNoneOnDeviceError();
  return e instanceof Error ? e : new Error(`passkey_failed:${typeof code === "string" ? code : "unknown"}`);
}

/** Only the members the module understands: unknown extension inputs would not survive its Android normaliser. */
function creationRequest(o: CreationOptionsJSON): PasskeyCreateRequest {
  return {
    challenge: o.challenge,
    rp: o.rp,
    user: o.user,
    pubKeyCredParams: o.pubKeyCredParams,
    timeout: o.timeout,
    excludeCredentials: o.excludeCredentials,
    authenticatorSelection: o.authenticatorSelection,
    attestation: o.attestation,
  };
}

function requestRequest(o: RequestOptionsJSON): PasskeyGetRequest {
  return {
    challenge: o.challenge,
    rpId: o.rpId,
    timeout: o.timeout,
    allowCredentials: o.allowCredentials,
    userVerification: o.userVerification,
  };
}

/** Run the registration ceremony with the server's options; resolves with the credential JSON to send back. */
export async function createPasskey(options: CreationOptionsJSON): Promise<RegistrationCredentialJSON> {
  try {
    const r = await Passkey.create(creationRequest(options));
    return {
      id: r.id,
      rawId: r.rawId,
      type: "public-key",
      authenticatorAttachment: r.authenticatorAttachment,
      clientExtensionResults: {},
      response: {
        clientDataJSON: r.response.clientDataJSON,
        attestationObject: r.response.attestationObject,
        transports: r.response.transports,
      },
    };
  } catch (e) {
    throw toTypedError(e);
  }
}

/** Run the sign-in ceremony with the server's options; resolves with the credential JSON to send back. */
export async function getPasskey(options: RequestOptionsJSON): Promise<AuthenticationCredentialJSON> {
  try {
    const r = await Passkey.get(requestRequest(options));
    return {
      id: r.id,
      rawId: r.rawId ?? r.id,
      type: "public-key",
      authenticatorAttachment: r.authenticatorAttachment,
      clientExtensionResults: {},
      response: {
        clientDataJSON: r.response.clientDataJSON,
        authenticatorData: r.response.authenticatorData,
        signature: r.response.signature,
        userHandle: r.response.userHandle,
      },
    };
  } catch (e) {
    throw toTypedError(e);
  }
}
