import * as SecureStore from "expo-secure-store";

/**
 * The three in-app alert preferences (Settings). They only govern what the app
 * does while it is OPEN — the foreground banner/sound and the in-app fallback
 * alert. Lock-screen pushes are controlled by the OS notification channel.
 *
 * Cached in memory so the notification handler (which must answer fast, inside
 * the 5-second accept window) never waits on the keystore.
 */
export const PREF_KEYS = { notifications: "pref.notifications", sound: "pref.sound", haptic: "pref.haptic" } as const;

export type PrefName = keyof typeof PREF_KEYS;
export type Prefs = Record<PrefName, boolean>;

const DEFAULTS: Prefs = { notifications: true, sound: true, haptic: true };

let cache: Prefs = { ...DEFAULTS };
let loading: Promise<Prefs> | null = null;

/** Load the stored prefs once (unset = on). Safe to call repeatedly. */
export function loadPrefs(): Promise<Prefs> {
  if (!loading) {
    loading = (async () => {
      const names = Object.keys(PREF_KEYS) as PrefName[];
      const values = await Promise.all(
        names.map((n) => SecureStore.getItemAsync(PREF_KEYS[n]).catch(() => null)),
      );
      const next = { ...DEFAULTS };
      names.forEach((n, i) => {
        next[n] = values[i] !== "0";
      });
      cache = next;
      return cache;
    })();
  }
  return loading;
}

/** The last known prefs, synchronously (defaults until loadPrefs resolves). */
export function getPrefs(): Prefs {
  return cache;
}

/** Update one pref in memory and persist it. */
export function setPref(name: PrefName, value: boolean): void {
  cache = { ...cache, [name]: value };
  SecureStore.setItemAsync(PREF_KEYS[name], value ? "1" : "0").catch(() => {});
}

// Warm the cache at import so the first foreground push already sees it.
void loadPrefs();
