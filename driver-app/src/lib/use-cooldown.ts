import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A resend cooldown timer. Call `start()` to begin an N-second countdown;
 * `remaining` ticks down to 0 and `active` is true while it runs. Used to gate
 * OTP "send/resend code" buttons so a new code can only be requested once per
 * minute. The interval is cleared on unmount and on each restart.
 */
export function useCooldown(seconds = 60): { remaining: number; active: boolean; start: () => void } {
  const [remaining, setRemaining] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clear();
    setRemaining(seconds);
    timer.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clear();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }, [seconds, clear]);

  useEffect(() => clear, [clear]);

  return { remaining, active: remaining > 0, start };
}
