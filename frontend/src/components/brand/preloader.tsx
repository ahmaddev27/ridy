"use client";

import { Logo } from "./logo";

/**
 * Full-screen branded preloader: the real Reidey mark breathes while a little car
 * runs along a track beneath it. Used as the route loading fallback so
 * navigations show the brand instead of a blank screen.
 */
export function Preloader() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-white">
      <style>{`
        @keyframes reidey-breathe { 0%,100% { opacity:.55; transform:scale(.97) } 50% { opacity:1; transform:scale(1) } }
        .reidey-mark { animation: reidey-breathe 1.6s ease-in-out infinite; }
        @keyframes reidey-drive { 0% { left:-14% } 100% { left:100% } }
        .reidey-car { position:absolute; top:-9px; animation: reidey-drive 1.4s linear infinite; }
        @keyframes reidey-pulse { 0%,100% { opacity:.4 } 50% { opacity:1 } }
        .reidey-word { animation: reidey-pulse 1.6s ease-in-out infinite; }
      `}</style>

      <div className="reidey-mark text-slate-900">
        <Logo size={104} />
      </div>

      {/* Track with a car running across it */}
      <div className="relative h-1 w-40 overflow-visible rounded-full bg-slate-200">
        <svg className="reidey-car" width={26} height={16} viewBox="0 0 26 16" fill="none" aria-hidden>
          <rect x={1} y={5} width={24} height={8} rx={3} fill="#0f172a" />
          <rect x={6} y={1} width={12} height={6} rx={2.4} fill="#0f172a" />
          <circle cx={8} cy={14} r={2.4} fill="#0f172a" stroke="#fff" strokeWidth={1.2} />
          <circle cx={18} cy={14} r={2.4} fill="#0f172a" stroke="#fff" strokeWidth={1.2} />
        </svg>
      </div>

      <div className="reidey-word text-sm font-bold tracking-[0.2em] text-slate-700">REIDEY</div>
    </div>
  );
}
