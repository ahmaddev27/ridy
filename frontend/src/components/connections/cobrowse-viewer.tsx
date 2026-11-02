"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import type { CobrowseTicket } from "@/lib/api/uber-login";

export type CobrowseEndReason = "solved" | "timeout" | "idle" | "cancel" | "violation" | "error";
type ViewState = "connecting" | "live" | "ended" | "error";

/** Server limit is 120 msg/s; stay well under it. Down/up are never throttled. */
const MOVE_INTERVAL_MS = 25;

function formatRemaining(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function useCountdown(ttlSeconds: number, active: boolean): number {
  const [left, setLeft] = useState(ttlSeconds);
  useEffect(() => {
    if (!active) return;
    const endsAt = Date.now() + ttlSeconds * 1000;
    const timer = setInterval(() => setLeft(Math.max(0, (endsAt - Date.now()) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active, ttlSeconds]);
  return left;
}

/** Editing keys uber-auth accepts (docs/28 §11.1). Anything else is a violation that closes the stream. */
const NAMED_KEYS = new Set(["Backspace", "Tab", "Enter", "End", "Home", "ArrowLeft", "ArrowRight", "Delete"]);
/** Upper bound of characters relayed from one IME/mobile input event (server limit is 120 msg/s). */
const MAX_TEXT_PER_INPUT = 64;

type KeyMessage = { t: "k"; c: string } | { t: "k"; n: string };

/** Maps a keydown to exactly one of the two schema shapes, or null (send nothing). */
function keyMessage(e: React.KeyboardEvent): KeyMessage | null {
  // AltGr reports ctrl+alt on Windows but is how "@", "€", "\\" are typed on a German layout.
  const altGr = e.getModifierState("AltGraph");
  if ((e.ctrlKey || e.altKey || e.metaKey) && !altGr) return null;
  if (NAMED_KEYS.has(e.key)) return { t: "k", n: e.key };
  if (e.key.length === 1) return { t: "k", c: e.key };
  return null;
}

/**
 * Live stream of the server-side browser (docs/28). Relays mouse move/down/up as
 * coordinates normalised to [0,1] and, for the full co-browse login (§11), keystrokes:
 * `{t:"k",c:"<one char>"}` or `{t:"k",n:"<Backspace|Tab|Enter|End|Home|ArrowLeft|ArrowRight|Delete>"}`.
 * Keys are captured on a hidden input inside this component only (never document/window),
 * so the dashboard's own fields are unaffected; the one-time code is typed straight into
 * Uber and never passes through our UI state. Frames are painted and dropped; nothing is
 * stored or logged.
 */
export function CobrowseViewer({
  ticket,
  onEnded,
  onClose,
}: {
  ticket: CobrowseTicket;
  /** Fired once when the server ends the stream (reason "solved" -> resume the login flow). */
  onEnded: (reason: CobrowseEndReason) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.connections.${k}`);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastMoveRef = useRef(0);
  const onEndedRef = useRef(onEnded);
  const [state, setState] = useState<ViewState>("connecting");
  const [reason, setReason] = useState<CobrowseEndReason | null>(null);
  const [size, setSize] = useState(ticket.viewport);
  const left = useCountdown(ticket.session_ttl, state === "live" || state === "connecting");

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    let disposed = false;
    const ws = new WebSocket(ticket.ws_url);
    ws.binaryType = "blob";
    wsRef.current = ws;

    const paint = async (blob: Blob) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const bitmap = await createImageBitmap(blob).catch(() => null);
      if (!bitmap || disposed) return bitmap?.close();
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      bitmap.close();
    };

    const onText = (raw: string) => {
      let msg: { t?: string; w?: number; h?: number; reason?: CobrowseEndReason };
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.t === "hello" && msg.w && msg.h) {
        setSize({ w: msg.w, h: msg.h });
        setState("live");
      } else if (msg.t === "end") {
        const why = msg.reason ?? "error";
        setReason(why);
        setState("ended");
        ws.close(1000);
        onEndedRef.current(why);
      }
    };

    ws.onopen = () => ws.send(JSON.stringify({ t: "auth", ticket: ticket.ticket }));
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string") onText(ev.data);
      else void paint(ev.data as Blob);
    };
    ws.onerror = () => !disposed && setState((s) => (s === "ended" ? s : "error"));
    // 4401/4409/4429/1008 and any abnormal drop before an "end" message are errors.
    ws.onclose = () => !disposed && setState((s) => (s === "ended" ? s : "error"));

    return () => {
      disposed = true;
      ws.onmessage = ws.onclose = ws.onerror = null;
      if (ws.readyState <= WebSocket.OPEN) ws.close(1000);
      wsRef.current = null;
    };
  }, [ticket]);

  function send(kind: "move" | "down" | "up", e: React.PointerEvent<HTMLCanvasElement>) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || state !== "live") return;
    if (kind === "move") {
      const now = performance.now();
      if (now - lastMoveRef.current < MOVE_INTERVAL_MS) return;
      lastMoveRef.current = now;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const x = clamp((e.clientX - rect.left) / rect.width);
    const y = clamp((e.clientY - rect.top) / rect.height);
    ws.send(JSON.stringify({ t: "m", k: kind, x, y }));
  }

  function sendKey(msg: KeyMessage) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && state === "live") ws.send(JSON.stringify(msg));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    const msg = keyMessage(e);
    if (!msg) return; // off-schema: send nothing, let the browser do its own thing
    e.preventDefault();
    sendKey(msg);
  }

  // Mobile / IME text arrives as input events (keydown reports "Unidentified"); desktop keys
  // are preventDefault-ed above so they never reach here twice.
  function onInput(e: React.FormEvent<HTMLInputElement>) {
    const native = e.nativeEvent as InputEvent;
    if (!native.isComposing) {
      Array.from(native.data ?? "")
        .slice(0, MAX_TEXT_PER_INPUT)
        .forEach((ch) => sendKey({ t: "k", c: ch }));
      if (native.inputType === "deleteContentBackward") sendKey({ t: "k", n: "Backspace" });
    }
    if (!native.isComposing) e.currentTarget.value = "";
  }

  const showCanvas = state === "live" || state === "connecting";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-sm text-ink-muted">
        <span className="flex items-center gap-2" role="status" aria-live="polite">
          {state === "connecting" && (
            <>
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> {c("cobrowseConnecting")}
            </>
          )}
          {state === "live" && c("cobrowseLive")}
          {state === "ended" && c(`cobrowseEnded_${reason ?? "error"}`)}
          {state === "error" && c("cobrowseError")}
        </span>
        {showCanvas && (
          <span className="shrink-0 text-xs text-ink-subtle" dir="ltr">
            {c("cobrowseEnds").replace("{time}", formatRemaining(left))}
          </span>
        )}
      </div>
      {showCanvas && (
        <input
          ref={inputRef}
          type="text"
          aria-label={c("cobrowseKeyboard")}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onKeyDown={onKeyDown}
          onInput={onInput}
          onPaste={(e) => e.preventDefault()}
          className="pointer-events-none absolute h-px w-px opacity-0"
        />
      )}
      {showCanvas && (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={c("cobrowseAlt")}
          width={size.w}
          height={size.h}
          // Fit to width, but never taller than ~88vh: cap the width by the aspect ratio instead.
          style={{ aspectRatio: `${size.w} / ${size.h}`, maxWidth: `min(100%, calc(88vh * ${size.w / size.h}))`, touchAction: "none" }}
          className="mx-auto block h-auto w-full cursor-pointer rounded-xl border border-line-strong bg-surface-2 object-contain"
          onPointerMove={(e) => send("move", e)}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            inputRef.current?.focus({ preventScroll: true });
            send("down", e);
          }}
          onPointerUp={(e) => send("up", e)}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
      <div className="flex justify-center">
        <button type="button" onClick={onClose} className="text-sm text-ink-muted underline underline-offset-2 hover:text-ink">
          {c("cobrowseClose")}
        </button>
      </div>
    </div>
  );
}
