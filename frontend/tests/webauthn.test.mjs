// Run with `npm test` (node --test; Node >= 23.6 strips the TypeScript types).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PasskeyAlreadyRegisteredError,
  PasskeyCancelledError,
  createPasskey,
  getPasskey,
  supportsPasskeys,
} from "../src/lib/webauthn.ts";

const buf = (...values) => new Uint8Array(values).buffer;
const bytes = (buffer) => [...new Uint8Array(buffer)];

/** Run `fn` with a stand-in `window` / `navigator`, restoring the real globals after. */
async function withBrowser({ credentials, PublicKeyCredential = class {} } = {}, fn) {
  const saved = ["window", "navigator"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, "window", { value: { PublicKeyCredential }, configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: { credentials }, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

const REQUEST_OPTIONS = { challenge: "AQID", rpId: "reidey.de", allowCredentials: [], userVerification: "preferred" };
const CREATION_OPTIONS = {
  rp: { name: "Reidey", id: "reidey.de" },
  user: { id: "AQID", name: "a@b.de", displayName: "A" },
  challenge: "-_8",
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  excludeCredentials: [{ type: "public-key", id: "BAUG", transports: ["internal"] }],
  attestation: "none",
};

test("supportsPasskeys is false without a browser and follows window.PublicKeyCredential", async () => {
  assert.equal(supportsPasskeys(), false);
  assert.equal(await withBrowser({}, () => supportsPasskeys()), true);
  // null, not undefined: the helper's default would replace undefined with a stub class.
  assert.equal(await withBrowser({ PublicKeyCredential: null }, () => supportsPasskeys()), false);
});

test("createPasskey converts options and the credential when the browser has no JSON bridges", async () => {
  let seen;
  const credentials = {
    create: async ({ publicKey }) => {
      seen = publicKey;
      return {
        id: "cred-id",
        rawId: buf(0xfb, 0xff, 0xfe),
        type: "public-key",
        authenticatorAttachment: "platform",
        response: { clientDataJSON: buf(1, 2), attestationObject: buf(3, 4), getTransports: () => ["internal"] },
      };
    },
  };

  const out = await withBrowser({ credentials }, () => createPasskey(CREATION_OPTIONS));

  assert.deepEqual(bytes(seen.challenge), [0xfb, 0xff]); // "-_8" is URL-safe base64
  assert.deepEqual(bytes(seen.user.id), [1, 2, 3]);
  assert.deepEqual(bytes(seen.excludeCredentials[0].id), [4, 5, 6]);
  assert.deepEqual(seen.excludeCredentials[0].transports, ["internal"]);
  assert.equal(seen.rp.id, "reidey.de");
  assert.equal(seen.attestation, "none");
  assert.deepEqual(out, {
    id: "cred-id",
    rawId: "-__-", // URL-safe alphabet, no padding
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    response: { clientDataJSON: "AQI", attestationObject: "AwQ", transports: ["internal"] },
  });
});

test("getPasskey converts options and the assertion, userHandle included", async () => {
  let seen;
  const credentials = {
    get: async ({ publicKey }) => {
      seen = publicKey;
      return {
        id: "cred-id",
        rawId: buf(9),
        type: "public-key",
        authenticatorAttachment: null,
        response: {
          clientDataJSON: buf(1),
          authenticatorData: buf(2),
          signature: buf(3),
          userHandle: buf(4, 5),
        },
      };
    },
  };

  const out = await withBrowser({ credentials }, () => getPasskey(REQUEST_OPTIONS));

  assert.deepEqual(bytes(seen.challenge), [1, 2, 3]);
  assert.deepEqual(seen.allowCredentials, []);
  assert.equal(seen.rpId, "reidey.de");
  assert.equal(seen.userVerification, "preferred");
  assert.equal(out.authenticatorAttachment, undefined);
  assert.deepEqual(out.response, {
    clientDataJSON: "AQ",
    authenticatorData: "Ag",
    signature: "Aw",
    userHandle: "BAU",
  });
});

test("a missing userHandle stays absent instead of becoming an empty string", async () => {
  const credentials = {
    get: async () => ({
      id: "c",
      rawId: buf(9),
      type: "public-key",
      authenticatorAttachment: null,
      response: { clientDataJSON: buf(1), authenticatorData: buf(2), signature: buf(3), userHandle: null },
    }),
  };

  const out = await withBrowser({ credentials }, () => getPasskey(REQUEST_OPTIONS));

  assert.equal(out.response.userHandle, undefined);
});

test("the browser's native JSON bridges are used when present", async () => {
  const parsed = { challenge: new ArrayBuffer(1) };
  let parsedFrom;
  class NativePublicKeyCredential {
    static parseRequestOptionsFromJSON(json) {
      parsedFrom = json;
      return parsed;
    }
  }
  const credentials = {
    get: async ({ publicKey }) => {
      assert.equal(publicKey, parsed);
      return { toJSON: () => ({ id: "from-toJSON" }) };
    },
  };

  const out = await withBrowser({ credentials, PublicKeyCredential: NativePublicKeyCredential }, () =>
    getPasskey(REQUEST_OPTIONS),
  );

  assert.equal(parsedFrom, REQUEST_OPTIONS);
  assert.deepEqual(out, { id: "from-toJSON" });
});

test("a dismissed prompt surfaces as PasskeyCancelledError", async () => {
  const dismissed = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  const credentials = { get: dismissed, create: dismissed };

  await withBrowser({ credentials }, async () => {
    await assert.rejects(getPasskey(REQUEST_OPTIONS), PasskeyCancelledError);
    await assert.rejects(createPasskey(CREATION_OPTIONS), PasskeyCancelledError);
  });
});

test("a null credential is treated like a dismissal", async () => {
  const credentials = { get: async () => null };

  await withBrowser({ credentials }, () => assert.rejects(getPasskey(REQUEST_OPTIONS), PasskeyCancelledError));
});

test("InvalidStateError on create means this authenticator already has the passkey", async () => {
  const credentials = { create: () => Promise.reject(new DOMException("excluded", "InvalidStateError")) };

  await withBrowser({ credentials }, () =>
    assert.rejects(createPasskey(CREATION_OPTIONS), PasskeyAlreadyRegisteredError),
  );
});

test("other failures pass through untouched, and InvalidStateError on get is not a duplicate", async () => {
  const insecure = new DOMException("bad rp id", "SecurityError");
  const invalid = new DOMException("not active", "InvalidStateError");

  await withBrowser({ credentials: { get: () => Promise.reject(insecure) } }, () =>
    assert.rejects(getPasskey(REQUEST_OPTIONS), (err) => err === insecure),
  );
  await withBrowser({ credentials: { get: () => Promise.reject(invalid) } }, () =>
    assert.rejects(getPasskey(REQUEST_OPTIONS), (err) => err === invalid),
  );
});
