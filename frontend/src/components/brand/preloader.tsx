"use client";

import { Logo } from "./logo";

/**
 * Full-screen branded preloader: the Reidey mark breathes while a car drives
 * along a winding, map-like route beneath it (following the curve and turning
 * into the bends). Shown as the route loading fallback so navigations show the
 * brand instead of a blank screen.
 */
export function Preloader() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-7 bg-surface">
      <style>{`
        @keyframes reidey-breathe { 0%,100% { opacity:.6; transform:scale(.97) } 50% { opacity:1; transform:scale(1) } }
        .reidey-mark { animation: reidey-breathe 1.8s ease-in-out infinite; }
        @keyframes reidey-pulse { 0%,100% { opacity:.45 } 50% { opacity:1 } }
        .reidey-word { animation: reidey-pulse 1.8s ease-in-out infinite; }
        @keyframes reidey-dash { to { stroke-dashoffset: -32; } }
        .reidey-route { animation: reidey-dash 1.1s linear infinite; }
      `}</style>

      <div className="reidey-mark text-ink">
        <Logo size={120} />
      </div>

      {/* A car driving along a winding map route */}
      <svg width={220} height={110} viewBox="0 0 260 130" fill="none" aria-hidden className="text-ink">
        <defs>
          <path id="reidey-route" d="M 22 100 C 74 100, 66 30, 128 36 S 196 104, 238 62" />
        </defs>

        {/* The route line (dashed, like a map path) */}
        <use
          href="#reidey-route"
          className="reidey-route stroke-line"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray="1 11"
        />

        {/* Pickup (hollow) → drop-off (green square) markers */}
        <circle cx={22} cy={100} r={5} className="fill-surface stroke-ink-subtle" strokeWidth={2.5} />
        <rect x={233} y={57} width={10} height={10} rx={2.5} className="fill-emerald-500" />

        {/* The car — follows the route and rotates into the curve */}
        <g>
          <animateMotion dur="2.8s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
            <mpath href="#reidey-route" />
          </animateMotion>
          <g>
            {/* body + cabin */}
            <rect x={-13} y={-6} width={26} height={9} rx={4} className="fill-current" />
            <path d="M -8 -6 L -4.5 -11.5 L 6 -11.5 L 9.5 -6 Z" className="fill-current" />
            {/* windows (cut through to the background colour) */}
            <rect x={-3.5} y={-10.5} width={4.4} height={3.6} rx={1} className="fill-surface" />
            <rect x={1.6} y={-10.5} width={4} height={3.6} rx={1} className="fill-surface" />
            {/* wheels */}
            <circle cx={-6.5} cy={3.5} r={3.2} className="fill-current stroke-surface" strokeWidth={1.4} />
            <circle cx={7.5} cy={3.5} r={3.2} className="fill-current stroke-surface" strokeWidth={1.4} />
            {/* headlight */}
            <circle cx={12.5} cy={-2} r={1.4} className="fill-amber-400" />
          </g>
        </g>
      </svg>

      <div className="reidey-word text-sm font-bold tracking-[0.28em] text-ink">REIDEY</div>
    </div>
  );
}
