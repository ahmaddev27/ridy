import * as Device from "expo-device";
import { api, type DriverPasskey } from "./api";
import { createPasskey } from "./passkeys";

/**
 * Add a passkey to the signed-in driver: server options -> OS sheet -> server.
 * The alias defaults to the phone model so the list in Settings tells two
 * devices apart. Throws `PasskeyCancelledError` when the sheet is dismissed.
 */
export async function enrolPasskey(): Promise<DriverPasskey> {
  const { ceremony_id, options } = await api.passkeyRegisterOptions();
  const credential = await createPasskey(options);
  const alias = Device.modelName?.slice(0, 60) || undefined;
  const res = await api.passkeyRegister(ceremony_id, credential, alias);
  return res.data;
}
