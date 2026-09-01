import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

/**
 * A short in-app "new offer" chime, played directly (not via a notification) so it
 * reliably sounds while the app is OPEN — the OS push only chimes in the background.
 * One reused player; configured once to sound even when the phone is on silent, since
 * a dispatch offer is time-critical.
 */
let player: AudioPlayer | null = null;
let configured = false;

export function playOfferSound(): void {
  try {
    if (!configured) {
      configured = true;
      // Play through the silent switch — an offer alert must be heard.
      setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    }
    if (player === null) {
      player = createAudioPlayer(require("../../assets/sounds/offer-alert.wav"));
    }
    player.seekTo(0);
    player.play();
  } catch {
    /* best-effort — a missing audio module must never break offer handling */
  }
}
