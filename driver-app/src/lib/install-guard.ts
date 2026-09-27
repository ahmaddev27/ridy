import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";

/**
 * iOS keeps Keychain items (our SecureStore session) across an uninstall, so a
 * reinstall silently restored the previous account. The app's Documents folder
 * IS wiped on uninstall, so we pair an install id stored in BOTH places: if the
 * Keychain has an id but the sandbox marker is missing/different, this is a
 * reinstall and every stored key is cleared before the session is restored.
 *
 * Upgrade-safe: an existing install that never ran this code has no Keychain
 * id yet, so it just gets one — nobody is signed out by the update itself.
 */
const INSTALL_ID_KEY = "reidey_install_id";
const MARKER_NAME = ".reidey-install";

/** Every SecureStore key the app writes. Keep in sync when adding a key. */
export const STORED_KEYS = [
  "reidey_driver_token",
  "reidey_is_owner",
  "reidey_push_token",
  "reidey_push_meta",
  "locale",
  "theme",
  "pref.notifications",
  "pref.sound",
  "pref.haptic",
] as const;

let guard: Promise<void> | null = null;

function newInstallId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function run(): Promise<void> {
  const marker = new File(Paths.document, MARKER_NAME);
  const stored = await SecureStore.getItemAsync(INSTALL_ID_KEY).catch(() => null);
  const onDisk = marker.exists ? marker.textSync().trim() || null : null;
  if (stored && stored === onDisk) return;

  if (stored && stored !== onDisk) {
    await Promise.all(STORED_KEYS.map((key) => SecureStore.deleteItemAsync(key).catch(() => {})));
  }

  const id = onDisk ?? newInstallId();
  if (!marker.exists) marker.create();
  marker.write(id);
  // Only after the marker is safely on disk — otherwise a failing write would
  // make every later launch look like a reinstall.
  await SecureStore.setItemAsync(INSTALL_ID_KEY, id);
}

/** Run the reinstall check once per process; later calls share the result. */
export function ensureFreshInstall(): Promise<void> {
  if (!guard) guard = run().catch(() => {});
  return guard;
}
